import { createDeepgramTranscriber } from "./stt.js";
import { getBuddyDemoOptions, parseBuddyChoice } from "./catalog.js";
import { chooseDeliveryOption, describeDeliveryOptions, naturalDeliveryLabel } from "./delivery.js";
import { openAiTwilioAudio } from "./openai-tts.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers:{"content-type":"application/json; charset=utf-8"} });
}
function base64ByteLength(value="") { const s=String(value); if(!s)return 0; const p=s.endsWith("==")?2:s.endsWith("=")?1:0; return Math.max(0,Math.floor(s.length*3/4)-p); }
function bytesToBase64(bytes){const v=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s="";for(let i=0;i<v.length;i+=0x8000)s+=String.fromCharCode(...v.subarray(i,i+0x8000));return btoa(s);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function normalizeUtterance(value=""){return String(value).toLowerCase().replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}
function mentionsSigned(value=""){return /\b(signed|finished|done|submitted|sent it|completed)\b/i.test(String(value));}
function cleanRuntimeToken(value=""){return String(value||"").replace(/[^A-Za-z0-9_-]/g,"");}

async function emitEvent(env,event){
  try{if(env.EVENTS)await env.EVENTS.send({...event,ts:Date.now()});}catch(e){console.error("media queue event failed",e);}
  try{if(env.ANALYTICS)env.ANALYTICS.writeDataPoint({blobs:[event.type||"stream.event",event.contactId||"",event.callSid||"",event.streamSid||""],doubles:[Date.now(),Number(event.mediaBytes||0),Number(event.mediaChunks||0)]});}catch(e){console.error("media analytics event failed",e);}
}
async function runtimeJson(env,path,body){
  const base=String(env.BUDDY_RUNTIME_URL||"").trim().replace(/\/$/,""); const token=cleanRuntimeToken(env.BUDDY_RUNTIME_TOKEN);
  if(!base)throw new Error("BUDDY_RUNTIME_URL is not configured"); if(!token)throw new Error("BUDDY_RUNTIME_TOKEN is not configured");
  const r=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json","x-runtime-token":token},body:JSON.stringify(body)});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{d={raw:t};}if(!r.ok)throw new Error(d?.detail||d?.error||`Buddy runtime ${path} failed (${r.status})`);return d;
}
async function runtimeTwilioAudio(env,text){
  if(String(env.OPENAI_API_KEY||"").trim()){
    try{
      const premium=await openAiTwilioAudio(env,text);
      console.log("Buddy premium TTS generated",{provider:premium.provider,model:premium.model,voice:premium.voice,audioBytes:premium.audio.length});
      return premium.audio;
    }catch(error){
      console.error("Premium OpenAI TTS failed; falling back to GPU Kokoro",error?.message||String(error));
    }
  }
  const base=String(env.BUDDY_RUNTIME_URL||"").trim().replace(/\/$/,""); const token=cleanRuntimeToken(env.BUDDY_RUNTIME_TOKEN);
  if(!base||!token)throw new Error("Buddy runtime is not configured");
  const r=await fetch(`${base}/tts/twilio`,{method:"POST",headers:{"content-type":"application/json","x-runtime-token":token},body:JSON.stringify({text})});
  if(!r.ok)throw new Error(`Buddy runtime TTS failed (${r.status}): ${(await r.text()).slice(0,240)}`);return new Uint8Array(await r.arrayBuffer());
}
async function conciergeRequest(env,path,payload){
  const secret=String(env.INTERNAL_CALL_SECRET||""); if(!secret)throw new Error("INTERNAL_CALL_SECRET is not configured for concierge handoff");
  const req=new Request(`https://concierge.internal${path}`,{method:"POST",headers:{"content-type":"application/json","x-internal-call-secret":secret},body:JSON.stringify(payload)});
  const r=env.CONCIERGE?await env.CONCIERGE.fetch(req):await fetch(`https://blackhole-concierge-worker.cryptocapitalgroupfl.workers.dev${path}`,{method:"POST",headers:{"content-type":"application/json","x-internal-call-secret":secret},body:JSON.stringify(payload)});
  const t=await r.text();let d={};try{d=t?JSON.parse(t):{};}catch{d={raw:t};}if(!r.ok||d?.ok===false){console.error("Concierge handoff rejected",{path,status:r.status,body:d,via:env.CONCIERGE?"service-binding":"public-fetch"});throw new Error(d?.error||`Concierge request failed (${r.status})`);}return d;
}
const notifyProductSelection=(env,p)=>conciergeRequest(env,"/internal/product-selected",p);
const getDeliveryOptions=(env,id)=>conciergeRequest(env,"/internal/delivery-options",{contactId:id});
const scheduleDelivery=(env,id,o)=>conciergeRequest(env,"/internal/delivery-schedule",{contactId:id,startIso:o.startIso,endIso:o.endIso,timeZone:o.timeZone});
async function getContactStatus(env,id){if(!id)return null;try{return await conciergeRequest(env,"/internal/contact-status",{contactId:id});}catch(e){console.error("Buddy contact status lookup failed",{contactId:id,error:e?.message||String(e)});return null;}}
async function completeTwilioCall(env,callSid){const a=String(env.TWILIO_ACCOUNT_SID||""),t=String(env.TWILIO_AUTH_TOKEN||"");if(!a||!t||!callSid)return;await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(a)}/Calls/${encodeURIComponent(callSid)}.json`,{method:"POST",headers:{Authorization:`Basic ${btoa(`${a}:${t}`)}`,"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({Status:"completed"}).toString()}).catch(()=>{});}

export function handleTwilioMediaSocket(request,env,ctx){
  if((request.headers.get("Upgrade")||"").toLowerCase()!=="websocket")return json({ok:false,error:"Expected Upgrade: websocket"},426);
  const pair=new WebSocketPair(); const [client,server]=Object.values(pair); server.accept();
  const state={
    connectedAt:Date.now(),streamSid:"",callSid:"",accountSid:"",contactId:"",firstName:"",lastName:"",phone:"",email:"",interest:"",location:"",comments:"",leadScore:"",preferredContactTime:"",
    mediaChunks:0,mediaBytes:0,lastTimestamp:"",lastSequenceNumber:"",transcriptCount:0,stt:null,utteranceParts:[],turnGeneration:0,responseCount:0,
    selectedProduct:null,documentStatus:"Not sent",signatureAcknowledged:false,deliveryOptions:[],awaitingDeliveryChoice:false,deliveryScheduled:false,
    optionsOffered:false,awaitingProductChoice:false,lastUtterance:"",lastUtteranceAt:0,lastClarifyAt:0,lastPendingDocPromptAt:0,
  };
  const pushEvent=(e)=>{const p=emitEvent(env,e);if(ctx?.waitUntil)ctx.waitUntil(p);else p.catch(()=>{});};
  const sendTwilioClear=()=>{if(state.streamSid)try{server.send(JSON.stringify({event:"clear",streamSid:state.streamSid}));}catch{}};
  function sendTwilioAudio(audioBytes,markName){if(!state.streamSid||!audioBytes?.length)return;server.send(JSON.stringify({event:"media",streamSid:state.streamSid,media:{payload:bytesToBase64(audioBytes)}}));server.send(JSON.stringify({event:"mark",streamSid:state.streamSid,mark:{name:markName}}));}
  async function speak(text,generation,eventType="buddy.turn.completed"){
    const audio=await runtimeTwilioAudio(env,text); if(generation!==state.turnGeneration)return;
    state.responseCount+=1; sendTwilioAudio(audio,`buddy-${state.responseCount}-${Date.now()}`);
    console.log("Buddy deterministic response sent",{callSid:state.callSid,contactId:state.contactId,responseText:text,audioBytes:audio.length});
    pushEvent({type:eventType,callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,response:text,audioBytes:audio.length});
  }
  function offerText(options){
    if(!options.length)return "Hi, this is Buddy with Buddy's Home Furnishings. I don't have demo choices available for that category right now.";
    const one=options[0]?.name||"option one",two=options[1]?.name||"option two";
    const hello=state.firstName?`Hi ${state.firstName}, this is Buddy, your personal shopping assistant with Buddy's Home Furnishings.`:"Hi, this is Buddy, your personal shopping assistant with Buddy's Home Furnishings.";
    return `${hello} I have two choices for ${state.interest||"your request"}: option one, ${one}, or option two, ${two}. Which one works for you?`;
  }
  function duplicateUtterance(clean){
    const n=normalizeUtterance(clean),now=Date.now(); if(!n)return true;
    const dup=n===state.lastUtterance && now-state.lastUtteranceAt<2500; state.lastUtterance=n; state.lastUtteranceAt=now; return dup;
  }

  function processUtterance(transcript){
    const clean=String(transcript||"").trim(); if(!clean||!state.streamSid||duplicateUtterance(clean))return;
    const generation=++state.turnGeneration; const startedAt=Date.now();
    const work=(async()=>{
      try{
        pushEvent({type:"buddy.turn.started",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript:clean});
        const options=getBuddyDemoOptions(state.interest);

        if(!state.selectedProduct && options.length){
          const choiceIndex=parseBuddyChoice(clean);
          if(choiceIndex>=0&&options[choiceIndex]){
            const selected=options[choiceIndex]; state.selectedProduct=selected; state.awaitingProductChoice=false;
            const payload={type:"buddy.product.selected",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,firstName:state.firstName,lastName:state.lastName,phone:state.phone,email:state.email,category:state.interest,interest:state.interest,location:state.location,comments:state.comments,leadScore:state.leadScore,preferredContactTime:state.preferredContactTime,selectionNumber:choiceIndex+1,productId:selected.id,productName:selected.name};
            pushEvent(payload);
            await speak(`Great choice${state.firstName?`, ${state.firstName}`:""}. I've got you down for the ${selected.name}. I'm getting your agreement ready now.`,generation,"buddy.product.selection-preparing");
            try{
              const result=await notifyProductSelection(env,payload); state.documentStatus="Sent";
              const smsOk=result?.sms?.ok===true,emailOk=result?.email?.ok===true;
              console.log("Buddy product selection handed to concierge",{contactId:state.contactId,productName:selected.name,envelopeId:result?.docusign?.envelopeId||"",smsOk,emailOk});
              if(generation!==state.turnGeneration)return;
              const sent=smsOk&&emailOk?"I sent the agreement to your phone and email.":emailOk?"I sent the agreement to your email.":smsOk?"I sent the agreement to your phone.":"I created your agreement, but the delivery message did not go through.";
              await speak(`${sent} Sign it, then wait for the confirmation text that says we received your documents before coming back to the call. It usually takes about 30 seconds.`,generation,"buddy.product.selection-sent");
            }catch(error){console.error("Buddy product selection handoff failed",{contactId:state.contactId,productName:selected.name,error:error?.message||String(error)});if(generation===state.turnGeneration)await speak("I saved your product choice, but I'm having trouble generating the agreement right now. Please give me a moment.",generation,"buddy.product.selection-failed");}
            return;
          }

          if(!state.optionsOffered){state.optionsOffered=true;state.awaitingProductChoice=true;await speak(offerText(options),generation,"buddy.product.options-offered");return;}
          if(state.awaitingProductChoice){
            const now=Date.now(); if(now-state.lastClarifyAt>6000){state.lastClarifyAt=now;await speak("Whenever you're ready, just say option one or option two.",generation,"buddy.product.choice-clarify");}
            return;
          }
        }

        if(state.selectedProduct&&state.contactId){
          const status=await getContactStatus(env,state.contactId); if(status?.documentStatus)state.documentStatus=status.documentStatus;if(status?.deliveryAt)state.deliveryScheduled=true;
          if(state.deliveryScheduled){await speak(`You're all set${state.firstName?`, ${state.firstName}`:""}. Your delivery is already scheduled. Thanks for calling Buddy's. Have a great day.`,generation,"buddy.delivery.already-scheduled");if(ctx?.waitUntil)ctx.waitUntil((async()=>{await sleep(12000);await completeTwilioCall(env,state.callSid);})());return;}

          if(String(state.documentStatus).toLowerCase()!=="signed"){
            if(mentionsSigned(clean)){
              const now=Date.now();if(now-state.lastPendingDocPromptAt>7000){state.lastPendingDocPromptAt=now;await speak("Thanks. I'm waiting for DocuSign to confirm it. Please wait for the confirmation text that says we received your documents, then come back to the call and tell me you're ready.",generation,"buddy.docusign.awaiting-confirmation");}
            }
            return;
          }

          if(!state.signatureAcknowledged){
            state.signatureAcknowledged=true;
            try{const delivery=await getDeliveryOptions(env,state.contactId);state.deliveryOptions=delivery?.options||[];state.awaitingDeliveryChoice=state.deliveryOptions.length>0;await speak(`Perfect${state.firstName?`, ${state.firstName}`:""}. I have your signed agreement for the ${state.selectedProduct.name}. Let's get your delivery scheduled. ${describeDeliveryOptions(state.deliveryOptions)}`,generation,"buddy.docusign.signed-acknowledged");}
            catch(error){console.error("Buddy delivery options failed",{contactId:state.contactId,error:error?.message||String(error)});await speak(`Perfect${state.firstName?`, ${state.firstName}`:""}. I have your signed agreement. I'm having trouble loading the live delivery calendar right now.`,generation,"buddy.delivery.options-failed");}
            return;
          }

          if(state.awaitingDeliveryChoice&&state.deliveryOptions.length){
            const selectedDelivery=chooseDeliveryOption(clean,state.deliveryOptions);
            if(!selectedDelivery){const now=Date.now();if(now-state.lastClarifyAt>6000){state.lastClarifyAt=now;await speak(describeDeliveryOptions(state.deliveryOptions),generation,"buddy.delivery.choice-clarify");}return;}
            const spokenSelection=naturalDeliveryLabel(selectedDelivery);
            await speak(`Perfect. I'll put you down for ${spokenSelection}. Give me just a second while I add that to the calendar.`,generation,"buddy.delivery.scheduling");
            try{const result=await scheduleDelivery(env,state.contactId,selectedDelivery);state.deliveryScheduled=true;state.awaitingDeliveryChoice=false;const scheduledOption={...selectedDelivery,startIso:result?.delivery?.start||selectedDelivery.startIso,timeZone:result?.delivery?.timeZone||selectedDelivery.timeZone};const label=naturalDeliveryLabel(scheduledOption);console.log("Buddy delivery scheduled",{contactId:state.contactId,calendarEventId:result?.delivery?.id||"",deliveryAt:result?.delivery?.start||selectedDelivery.startIso,smsOk:result?.sms?.ok??null,emailOk:result?.email?.ok??null});await speak(`You're confirmed for ${label}. I sent your confirmation by text and email. Thanks for calling Buddy's. Have a great day.`,generation,"buddy.delivery.confirmed");if(ctx?.waitUntil)ctx.waitUntil((async()=>{await sleep(14000);await completeTwilioCall(env,state.callSid);})());}
            catch(error){console.error("Buddy delivery scheduling failed",{contactId:state.contactId,error:error?.message||String(error)});try{const refreshed=await getDeliveryOptions(env,state.contactId);state.deliveryOptions=refreshed?.options||[];}catch{}await speak(`That time just got taken. ${describeDeliveryOptions(state.deliveryOptions)}`,generation,"buddy.delivery.conflict");}
            return;
          }
        }

        const chat=await runtimeJson(env,"/chat",{text:`${clean}\n\nSYSTEM: Speak like a warm retail associate on a phone call. Use natural contractions and plain spoken English. Keep it to one short sentence unless the customer asks for detail. Do not repeat yourself. Do not list product options unless the user explicitly asks what choices are available. Never say times as 7.00 p.m.; say 7 p.m. instead. Avoid stiff phrases like 'finalizing those details' or 'shall we get started'.`,firstName:state.firstName,interest:state.interest,location:state.location,leadScore:state.leadScore});
        if(generation!==state.turnGeneration)return;const responseText=String(chat.response||"").trim();if(!responseText)throw new Error("Buddy runtime returned an empty response");
        const audio=await runtimeTwilioAudio(env,responseText);if(generation!==state.turnGeneration)return;state.responseCount+=1;sendTwilioAudio(audio,`buddy-${state.responseCount}-${Date.now()}`);console.log("Buddy response sent",{callSid:state.callSid,contactId:state.contactId,responseText,audioBytes:audio.length,latencyMs:Date.now()-startedAt});pushEvent({type:"buddy.turn.completed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,response:responseText,audioBytes:audio.length,latencyMs:Date.now()-startedAt});
      }catch(error){console.error("Buddy turn failed",{callSid:state.callSid,contactId:state.contactId,error:error?.message||String(error)});pushEvent({type:"buddy.turn.failed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,error:error?.message||String(error)});}
    })(); if(ctx?.waitUntil)ctx.waitUntil(work);else work.catch(()=>{});
  }

  function flushUtterance(){if(!state.utteranceParts.length)return;const t=state.utteranceParts.join(" ").replace(/\s+/g," ").trim();state.utteranceParts=[];processUtterance(t);}
  function startTranscription(){
    if(state.stt||!env.DEEPGRAM_API_KEY)return;
    state.stt=createDeepgramTranscriber(env,{
      onOpen:({model})=>{console.log("Deepgram STT connected",{callSid:state.callSid,contactId:state.contactId,model});pushEvent({type:"stt.connected",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,model});},
      onTranscript:({transcript,isFinal,speechFinal,confidence})=>{if(isFinal)state.transcriptCount+=1;console.log("Deepgram transcript",{callSid:state.callSid,contactId:state.contactId,transcript,isFinal,speechFinal,confidence});if(isFinal){state.utteranceParts.push(transcript);pushEvent({type:"stt.transcript.final",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,transcript,confidence,speechFinal});if(speechFinal)flushUtterance();}},
      onSpeechStarted:()=>{state.turnGeneration+=1;sendTwilioClear();pushEvent({type:"stt.speech.started",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId});},
      onUtteranceEnd:()=>{flushUtterance();pushEvent({type:"stt.utterance.end",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId});},
      onClose:({code,reason})=>{console.log("Deepgram STT closed",{callSid:state.callSid,code,reason});pushEvent({type:"stt.closed",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId,closeCode:String(code||"")});},
      onError:()=>{console.error("Deepgram STT websocket error",{callSid:state.callSid});pushEvent({type:"stt.error",callSid:state.callSid,streamSid:state.streamSid,contactId:state.contactId});},
    });
  }
  function stopTranscription(){try{state.stt?.finalize();}catch{}try{state.stt?.close();}catch{}state.stt=null;}
  pushEvent({type:"stream.websocket.connected"});

  server.addEventListener("message",(event)=>{
    if(typeof event.data!=="string")return;let message;try{message=JSON.parse(event.data);}catch{return;}const type=String(message.event||"unknown");state.lastSequenceNumber=String(message.sequenceNumber||state.lastSequenceNumber||"");
    if(type==="connected"){console.log("Twilio media connected",{protocol:message.protocol||"",version:message.version||""});return;}
    if(type==="start"){
      const start=message.start||{},params=start.customParameters||{};state.streamSid=String(start.streamSid||message.streamSid||"");state.callSid=String(start.callSid||"");state.accountSid=String(start.accountSid||"");state.contactId=String(params.contactId||"");state.firstName=String(params.firstName||"");state.lastName=String(params.lastName||"");state.phone=String(params.phone||"");state.email=String(params.email||"");state.interest=String(params.interest||"");state.location=String(params.location||"");state.comments=String(params.comments||"");state.leadScore=String(params.leadScore||"");state.preferredContactTime=String(params.preferredContactTime||"");const f=start.mediaFormat||{};
      console.log("Twilio media stream started",{streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,encoding:f.encoding||"",sampleRate:f.sampleRate||"",channels:f.channels||"",sttConfigured:Boolean(env.DEEPGRAM_API_KEY),buddyRuntimeConfigured:Boolean(env.BUDDY_RUNTIME_URL&&env.BUDDY_RUNTIME_TOKEN),premiumTtsConfigured:Boolean(env.OPENAI_API_KEY),demoChoices:getBuddyDemoOptions(state.interest).length});pushEvent({type:"stream.media.started",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,firstName:state.firstName,interest:state.interest,location:state.location,leadScore:state.leadScore,encoding:String(f.encoding||""),sampleRate:Number(f.sampleRate||0),channels:Number(f.channels||0)});startTranscription();return;
    }
    if(type==="media"){const media=message.media||{},payload=String(media.payload||"");state.mediaChunks+=1;state.mediaBytes+=base64ByteLength(payload);state.lastTimestamp=String(media.timestamp||state.lastTimestamp||"");if(payload&&state.stt)state.stt.sendBase64(payload);if(state.mediaChunks%250===0)console.log("Twilio media heartbeat",{streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,timestamp:state.lastTimestamp,transcriptCount:state.transcriptCount,responseCount:state.responseCount});return;}
    if(type==="dtmf"){pushEvent({type:"stream.media.dtmf",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,digit:String(message.dtmf?.digit||"")});return;}
    if(type==="mark"){pushEvent({type:"buddy.audio.mark",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,name:String(message.mark?.name||"")});return;}
    if(type==="stop"){const stop=message.stop||{};state.streamSid=state.streamSid||String(message.streamSid||"");state.callSid=state.callSid||String(stop.callSid||"");const durationMs=Date.now()-state.connectedAt;stopTranscription();console.log("Twilio media stream stopped",{streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});pushEvent({type:"stream.media.stopped",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});return;}
  });
  server.addEventListener("close",(event)=>{state.turnGeneration+=1;stopTranscription();const durationMs=Date.now()-state.connectedAt;console.log("Twilio media websocket closed",{code:event.code,reason:event.reason,streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});pushEvent({type:"stream.websocket.closed",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId,closeCode:String(event.code||""),mediaChunks:state.mediaChunks,mediaBytes:state.mediaBytes,transcriptCount:state.transcriptCount,responseCount:state.responseCount,selectedProduct:state.selectedProduct?.name||"",documentStatus:state.documentStatus,deliveryScheduled:state.deliveryScheduled,durationMs});});
  server.addEventListener("error",()=>{state.turnGeneration+=1;stopTranscription();pushEvent({type:"stream.websocket.error",streamSid:state.streamSid,callSid:state.callSid,contactId:state.contactId});});
  return new Response(null,{status:101,webSocket:client});
}
