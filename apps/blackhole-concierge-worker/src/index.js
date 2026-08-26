import { createBuddySigningSession, docusignConfigured } from "./docusign.js";
import { createSigningShortLink, resolveSigningShortLink } from "./docusign-links.js";
import { fetchSignedEnvelopePdf } from "./docusign-document.js";
import { rememberSmsContact, getSmsContact, getSmsContactById } from "./sms-session.js";
import { createDeliveryEvent, googleCalendarConfigured, googleCalendarTimeZone, isSlotAvailable } from "./google-calendar.js";

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return new Uint8Array(digest);
}
async function secretsEqual(a,b) {
  const left=await sha256(a), right=await sha256(b); let diff=left.length^right.length;
  for(let i=0;i<Math.max(left.length,right.length);i++) diff|=(left[i]??0)^(right[i]??0);
  return diff===0;
}
async function authorizeInternal(request,env) {
  const configured=env.INTERNAL_CALL_SECRET||"", provided=request.headers.get("x-internal-call-secret")||"";
  if(!configured) return {ok:false,response:Response.json({ok:false,error:"Internal service authentication is not configured"},{status:503})};
  if(!provided||!(await secretsEqual(provided,configured))) return {ok:false,response:Response.json({ok:false,error:"Unauthorized"},{status:401})};
  return {ok:true};
}
function preferredMethod(payload={}) { return String(payload.contact?.preferredContactMethod||payload.lead?.contact_method||payload.lead?.preferredContactMethod||"").trim(); }
function smsConsentGranted(payload={}) { const v=payload.contact?.smsConsent??payload.lead?.consent; return v===true||v==="true"||v==="on"; }
function normalizePhone(v="") { return String(v||"").replace(/\D/g,"").replace(/^1(?=\d{10}$)/,""); }
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function callBinding(binding,url,payload){
  if(!binding) return {ok:false,skipped:true,reason:"Binding not configured"};
  try{
    const response=await binding.fetch(new Request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}));
    const text=await response.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    return response.ok?data:{ok:false,status:response.status,...data};
  }catch(e){return {ok:false,error:e.message};}
}
async function emit(env,event){
  if(env.EVENTS&&!String(event.type||"").startsWith("buddy.product.selected")){try{await env.EVENTS.send({...event,ts:Date.now()});}catch{}}
  if(env.ANALYTICS){try{env.ANALYTICS.writeDataPoint({blobs:[event.type||"concierge.event",event.contactId||"",event.envelopeId||""],doubles:[Date.now()]});}catch{}}
}
async function listDashboardContacts(env){
  const base=String(env.DASHBOARD_URL||"").replace(/\/$/,""); if(!base)return[];
  const response=await fetch(`${base}/api/contacts`); if(!response.ok)return[];
  const body=await response.json().catch(()=>({})); const rows=Array.isArray(body)?body:body?.data||body?.contacts||body?.rows||[];
  return Array.isArray(rows)?rows:[];
}
async function getDashboardContact(env,id){const rows=await listDashboardContacts(env);return rows.find(c=>c?.id===id)||null;}
async function getDashboardContactByPhone(env,phone){const target=normalizePhone(phone);if(!target)return null;const rows=await listDashboardContacts(env);return [...rows].reverse().find(c=>normalizePhone(c?.phone)===target)||null;}
async function updateDashboardContact(env,id,patch){
  if(!id)return null;const base=String(env.DASHBOARD_URL||"").replace(/\/$/,"");if(!base)return null;
  const response=await fetch(`${base}/api/contacts/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(patch)});
  return response.ok?await response.json().catch(()=>null):null;
}
function mergeContact(base={},payload={}){return{...base,id:payload.contactId||base.id||"",firstName:base.firstName||payload.firstName||"",lastName:base.lastName||payload.lastName||"",phone:base.phone||payload.phone||"",email:base.email||payload.email||"",location:base.location||payload.location||"",interest:base.interest||payload.category||payload.interest||"",comments:base.comments||payload.comments||"",leadScore:base.leadScore??payload.leadScore??"",smsConsent:base.smsConsent??payload.smsConsent??true};}
async function resolveContact(env,id,payload={}){
  const persisted=id?await getSmsContactById(env,id).catch(()=>null):null;
  const dashboard=id?await getDashboardContact(env,id).catch(()=>null):null;
  return mergeContact(persisted||dashboard||payload.contact||{},payload);
}
async function persistContact(env,contact,patch={}){
  const next={...contact,...patch};try{await rememberSmsContact(env,next);}catch{}
  return next;
}

function zonedParts(date,timeZone){const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);const out={};for(const p of parts)if(p.type!=="literal")out[p.type]=p.value;return{year:+out.year,month:+out.month,day:+out.day,hour:+out.hour,minute:+out.minute,second:+out.second};}
function timezoneOffsetMinutes(date,tz){const p=zonedParts(date,tz);return Math.round((Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-date.getTime())/60000);}
function localDateTimeToIso({year,month,day,hour,minute=0},tz){const guess=Date.UTC(year,month-1,day,hour,minute,0);let date=new Date(guess);const first=timezoneOffsetMinutes(date,tz);date=new Date(guess-first*60000);const second=timezoneOffsetMinutes(date,tz);if(second!==first)date=new Date(guess-second*60000);return date.toISOString();}
function addLocalDays(parts,days){const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days,12));return{year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};}
function formatDeliverySlot(startIso,tz){return new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"long",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(startIso));}
async function buildDeliveryOptions(env,now=new Date()){
  if(!googleCalendarConfigured(env))throw new Error("Google Calendar is not configured");
  const timeZone=googleCalendarTimeZone(env), localNow=zonedParts(now,timeZone), today={year:localNow.year,month:localNow.month,day:localNow.day};
  const specs=[],options=[];
  for(let days=0;days<14;days+=1){for(const hour of [11,14,19])specs.push({days,hour});}
  for(const spec of specs){const localDate=addLocalDays(today,spec.days);const startIso=localDateTimeToIso({...localDate,hour:spec.hour},timeZone);const endIso=new Date(new Date(startIso).getTime()+7200000).toISOString();if(new Date(startIso).getTime()<now.getTime()+1800000)continue;let available=false;try{available=await isSlotAvailable(env,startIso,endIso);}catch(e){throw new Error(`Google Calendar availability check failed: ${e.message}`);}if(!available)continue;options.push({startIso,endIso,label:formatDeliverySlot(startIso,timeZone),timeZone});if(options.length>=3)break;}
  return{timeZone,now:now.toISOString(),options};
}

async function requestBuddyCall(env,contact,trigger={}){
  if(!env.VOICE)return{ok:false,error:"VOICE binding not configured"};
  const payload={contactId:contact.id||trigger.contactId||"",contact,context:{firstName:contact.firstName,lastName:contact.lastName,phone:contact.phone,email:contact.email,interest:contact.interest,location:contact.location,comments:contact.comments,leadScore:contact.leadScore,preferredContactTime:contact.preferredContactTime,source:contact.source},trigger};
  const response=await env.VOICE.fetch(new Request("https://voice.internal/internal/calls",{method:"POST",headers:{"Content-Type":"application/json","x-internal-call-secret":env.INTERNAL_CALL_SECRET},body:JSON.stringify(payload)}));
  const text=await response.text();let result={};try{result=text?JSON.parse(text):{};}catch{result={raw:text};}if(!response.ok)throw new Error(result?.error||`Voice call failed (${response.status})`);
  await persistContact(env,contact,{stage:"Contacted",callStatus:"Call requested"});
  await updateDashboardContact(env,contact.id,{stage:"Contacted",callStatus:"Call requested"});
  await emit(env,{type:"call.requested",contactId:contact.id||"",payload});return result;
}

function buddyRuntimeConfig(env){
  return{
    baseUrl:String(env.BUDDY_RUNTIME_URL||"https://alley-voice.xyz-labs.xyz").replace(/\/$/,""),
    voiceId:String(env.BUDDY_VIDEO_VOICE_ID||"buddy").trim(),
  };
}

async function getBuddyRuntimeReadiness(env){
  const config=buddyRuntimeConfig(env);
  let response;
  try{
    response=await fetch(`${config.baseUrl}/health`,{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)});
  }catch(error){
    return{ok:false,baseUrl:config.baseUrl,voiceId:config.voiceId,errors:[`runtime health request failed: ${error.message}`]};
  }
  if(!response.ok)return{ok:false,baseUrl:config.baseUrl,voiceId:config.voiceId,errors:[`runtime health returned ${response.status}`]};
  const health=await response.json().catch(()=>null);
  if(!health)return{ok:false,baseUrl:config.baseUrl,voiceId:config.voiceId,errors:["runtime health returned invalid JSON"]};
  const availableVoices=Array.isArray(health?.tts?.availableVoices)?health.tts.availableVoices:[];
  const preparedVoices=Array.isArray(health?.tts?.preparedVoices)?health.tts.preparedVoices:[];
  const errors=[];
  if(health?.ok!==true)errors.push("runtime is not healthy");
  if(health?.compatibility?.chat!==true||health?.llm?.baseUrlConfigured!==true||!health?.llm?.model)errors.push("LLM chat is not configured");
  if(health?.tts?.loaded!==true)errors.push("TTS backend is not loaded");
  if(!availableVoices.includes(config.voiceId))errors.push(`voice '${config.voiceId}' is not available`);
  if(!preparedVoices.includes(config.voiceId))errors.push(`voice '${config.voiceId}' is not prepared`);
  return{
    ok:errors.length===0,
    baseUrl:config.baseUrl,
    voiceId:config.voiceId,
    llm:{provider:health?.llm?.provider||"",model:health?.llm?.model||""},
    tts:{backend:health?.tts?.backend||"",availableVoices,preparedVoices},
    errors,
  };
}

async function requireBuddyRuntime(env){
  const readiness=await getBuddyRuntimeReadiness(env);
  if(!readiness.ok)throw new Error(`Buddy runtime is not ready: ${readiness.errors.join("; ")}`);
  return readiness;
}


async function requestBuddyVideoSession(env,payload={}){
  if(!env.VIDEO)return{ok:false,error:"VIDEO binding not configured"};
  if(!env.BLACKHOLE_CAPABILITY_TOKEN)throw new Error("BLACKHOLE_CAPABILITY_TOKEN is not configured");
  const runtimeReadiness=await requireBuddyRuntime(env);
  const contactId=String(payload.contactId||payload.contact?.id||"").trim();
  const contact=contactId?await resolveContact(env,contactId,payload):mergeContact(payload.contact||{},payload.context||{});
  const directSessionId=crypto.randomUUID();
  const avatarSource=String(env.BUDDY_LIVE_SOURCE||"image-url").trim().toLowerCase();
  if(!["agent-id","image-url"].includes(avatarSource))throw new Error("BUDDY_LIVE_SOURCE must be agent-id or image-url");
  const lemonsliceAgentId=String(env.BUDDY_LEMONSLICE_AGENT_ID||"").trim();
  const avatarImageUrl=String(env.BUDDY_AVATAR_IMAGE_URL||"").trim();
  if(avatarSource==="agent-id"&&!lemonsliceAgentId)throw new Error("BUDDY_LEMONSLICE_AGENT_ID is required for agent-id sessions");
  if(avatarSource==="image-url"&&!avatarImageUrl)throw new Error("BUDDY_AVATAR_IMAGE_URL is required for image-url sessions");
  const instructions=[
    "# Identity",
    "You are Buddy, the friendly AI personal shopper for Buddy's Home Furnishings.",
    "# Goal",
    "Help the customer choose among furniture, mattresses, appliances, computers, electronics, smartphones, and gaming products. Ask focused questions about room, size, features, style, budget, timing, and preferred store area.",
    "# Sales workflow",
    "If lead context is provided, acknowledge what the customer already requested instead of asking them to repeat it. When the customer settles on a demo product, confirm the exact selection. The existing Buddy workflow will later handle the agreement and delivery scheduling.",
    "# Shared links",
    "The browser has a shared-links panel beside the conversation. When a real product, DocuSign, scheduling, or store link is available, include the complete https URL in your reply so it appears there. Never invent a product, agreement, or scheduling URL. For store lookup you may share https://www.buddyrents.com/store-locator.",
    "# Guardrails",
    "Never request or accept card, bank, Social Security, or other payment-source data. Explain that this is a demonstration when exact inventory, pricing, financing approval, or store availability is not connected. Do not invent stock or approval decisions.",
    "# Voice",
    "Spoken output only. Be warm, concise, conversational, and useful. Keep most turns under three sentences and ask one clear question at a time.",
    "# Known customer context",
    `Name: ${contact.firstName||payload.firstName||"Guest"} ${contact.lastName||payload.lastName||""}. Interest: ${contact.interest||payload.interest||"Not provided"}. Area: ${contact.location||payload.location||"Not provided"}. Notes: ${contact.comments||payload.comments||"None"}.`,
    "# Reminder",
    "You are Buddy in a live browser video conversation. Use the known context, keep replies natural, and never ask for payment details."
  ].join("\n\n").slice(0,5000);
  const upstream=await env.VIDEO.fetch(new Request("https://blackhole.internal/internal/video/session",{
    method:"POST",
    headers:{"content-type":"application/json","x-blackhole-capability-token":String(env.BLACKHOLE_CAPABILITY_TOKEN)},
    body:JSON.stringify({
      tenantId:"buddys",
      product:"buddys-personal-shopper",
      creatorId:"buddy",
      creatorName:"Buddy",
      creatorSlug:"buddy-personal-shopper",
      fanId:contactId||directSessionId,
      fanName:[contact.firstName||payload.firstName||"Buddy customer",contact.lastName||payload.lastName||""].filter(Boolean).join(" "),
      avatarProvider:"lemonslice",
      avatarSource,
      lemonsliceAgentId:avatarSource==="agent-id"?lemonsliceAgentId:"",
      avatarImageUrl:avatarSource==="image-url"?avatarImageUrl:"",
      avatarPrompt:String(env.BUDDY_AVATAR_PROMPT||"Use friendly, attentive upper-body movement and natural hand gestures while speaking.").trim(),
      voiceProvider:String(env.BUDDY_VIDEO_VOICE_PROVIDER||"eila-runtime").trim(),
      voiceModel:String(env.BUDDY_VIDEO_VOICE_MODEL||"").trim(),
      voiceId:String(env.BUDDY_VIDEO_VOICE_ID||"buddy").trim(),
      instructions,
      context:{contactId,firstName:contact.firstName||"",lastName:contact.lastName||"",interest:contact.interest||"",location:contact.location||"",comments:contact.comments||"",leadScore:contact.leadScore??payload.leadScore??""}
    })
  }));
  const text=await upstream.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
  if(!upstream.ok||data?.ok===false)throw new Error(data?.error||`Black Hole video worker failed (${upstream.status})`);
  if(contactId){
    await persistContact(env,contact,{stage:"Engaged",callStatus:"Video session created"});
    await updateDashboardContact(env,contactId,{stage:"Engaged",callStatus:"Video session created"});
  }
  await emit(env,{type:"video.session.created",contactId,room:data.room||"",dispatchId:data.dispatchId||"",source:payload.source||"buddy-web"});
  return{ok:true,...data,contactId:contactId||undefined,runtime:{voiceId:runtimeReadiness.voiceId,llm:runtimeReadiness.llm}};
}

async function processProductSelection(env,payload={}){
  const contactId=payload.contactId||payload.contact?.id||"",contact=await resolveContact(env,contactId,payload);
  const product={id:payload.productId||payload.product?.id||"",name:payload.productName||payload.product?.name||"",category:payload.category||contact.interest||""};const selectionNumber=Number(payload.selectionNumber||1);
  if(!contact.phone)throw new Error("Selected lead has no phone number");if(!contact.email)throw new Error("Selected lead has no email address for DocuSign signer identity");
  const docusign=await createBuddySigningSession(env,{contact,product,selectionNumber,contactId});
  const shortSigningUrl=await createSigningShortLink(env,{targetUrl:docusign.signingUrl,contactId,envelopeId:docusign.envelopeId});
  let sms={ok:false,skipped:true,reason:"SMS consent not granted"};
  if(contact.smsConsent!==false)sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact,messageType:"buddy-docusign",message:`Great choice${contact.firstName?`, ${contact.firstName}`:""}. Your Buddy's agreement for the ${product.name} is ready. Sign here: ${shortSigningUrl} Reply STOP to opt out.`,docusign:{...docusign,shortSigningUrl},product});
  const email=contact.email?await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact,messageType:"buddy-docusign",docusign:{...docusign,shortSigningUrl},product}):{ok:false,skipped:true};
  await persistContact(env,contact,{stage:"Docs Sent",callStatus:"In progress",selectedProduct:product.name,selectedProductId:product.id,selectionNumber,docusignEnvelopeId:docusign.envelopeId,agreementId:docusign.agreementId,documentStatus:"Sent",signingShortUrl:shortSigningUrl});
  await updateDashboardContact(env,contactId,{stage:"Docs Sent",documentStatus:"Sent",selectedProduct:product.name,selectedProductId:product.id,selectionNumber,docusignEnvelopeId:docusign.envelopeId,agreementId:docusign.agreementId});
  await emit(env,{type:"docusign.sent",contactId,envelopeId:docusign.envelopeId,agreementId:docusign.agreementId,productName:product.name,selectionNumber});
  return{ok:true,contactId,product,docusign:{...docusign,shortSigningUrl},sms,email};
}

async function scheduleDelivery(env,payload={}){
  const contactId=payload.contactId||"",contact=await resolveContact(env,contactId,payload);if(!contactId||!contact?.id)throw new Error("Delivery scheduling requires a valid contact");if(String(contact.documentStatus||"").toLowerCase()!=="signed")throw new Error("Agreement must be signed before delivery scheduling");if(!googleCalendarConfigured(env))throw new Error("Google Calendar is not configured");
  const startIso=String(payload.startIso||payload.start||"");if(!startIso||Number.isNaN(new Date(startIso).getTime()))throw new Error("A valid delivery start time is required");const durationMinutes=Math.max(30,Number(payload.durationMinutes||120));const endIso=String(payload.endIso||new Date(new Date(startIso).getTime()+durationMinutes*60000).toISOString());if(!(await isSlotAvailable(env,startIso,endIso)))return{ok:false,conflict:true,error:"That delivery slot is no longer available"};
  const product={name:contact.selectedProduct||contact.interest||"Buddy's order"};const calendar=await createDeliveryEvent(env,{contact,product,startIso,endIso,timeZone:payload.timeZone||googleCalendarTimeZone(env),contactId});const timeZone=calendar.timeZone||googleCalendarTimeZone(env),deliveryLabel=formatDeliverySlot(calendar.start,timeZone);
  const scheduled=await persistContact(env,contact,{stage:"Scheduled",callStatus:"Call completed",deliveryAt:calendar.start,deliveryEnd:calendar.end,deliveryStatus:"Scheduled",calendarEventId:calendar.id,calendarEventUrl:calendar.htmlLink});
  await updateDashboardContact(env,contactId,{stage:"Scheduled",callStatus:"Call completed",deliveryAt:calendar.start,deliveryEnd:calendar.end,deliveryStatus:"Scheduled",calendarEventId:calendar.id,calendarEventUrl:calendar.htmlLink});
  let sms={ok:false,skipped:true};if(scheduled.smsConsent!==false&&scheduled.phone)sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact:scheduled,messageType:"buddy-delivery-confirmed",message:`You're scheduled${scheduled.firstName?`, ${scheduled.firstName}`:""}. Buddy's delivery for ${product.name} is set for ${deliveryLabel}. Reply STOP to opt out.`,delivery:{...calendar,label:deliveryLabel},product});
  const email=scheduled.email?await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact:scheduled,messageType:"buddy-delivery-confirmed",delivery:{...calendar,label:deliveryLabel},product}):{ok:false,skipped:true};
  await emit(env,{type:"delivery.scheduled",contactId,calendarEventId:calendar.id,deliveryAt:calendar.start,productName:product.name});return{ok:true,contactId,delivery:{...calendar,label:deliveryLabel},sms,email};
}

export default { async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==="/api/health")return Response.json({ok:true,service:"buddys-concierge-worker",health:"online",runtime:"edge",docusign:docusignConfigured(env)?"configured":"not-configured",googleCalendar:googleCalendarConfigured(env)?"configured":"not-configured",googleCalendarTimeZone:googleCalendarTimeZone(env)});
  if(url.pathname==="/api/video/readiness"){
    const readiness=await getBuddyRuntimeReadiness(env);
    return Response.json(readiness,{status:readiness.ok?200:503});
  }
  if(url.pathname==="/docusign/consent-complete")return new Response("DocuSign consent granted. You can close this tab and return to Buddy.",{status:200,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  if(url.pathname.startsWith("/docusign/sign/")&&request.method==="GET"){const token=decodeURIComponent(url.pathname.slice("/docusign/sign/".length));const row=await resolveSigningShortLink(env,token).catch(()=>null);if(!row?.target_url)return new Response("This signing link is unavailable.",{status:404});return Response.redirect(String(row.target_url),302);}
  if(url.pathname.startsWith("/docusign/document/")&&request.method==="GET"){
    const contactId=decodeURIComponent(url.pathname.slice("/docusign/document/".length));const contact=await getSmsContactById(env,contactId).catch(()=>null);if(!contact?.docusignEnvelopeId)return new Response("Signed document not found.",{status:404});
    try{const pdf=await fetchSignedEnvelopePdf(env,contact.docusignEnvelopeId);const name=`Buddy-Agreement-${contact.firstName||"customer"}-${contact.lastName||""}.pdf`.replace(/[^A-Za-z0-9._-]+/g,"-");return new Response(pdf,{status:200,headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename=\"${name}\"`,"Cache-Control":"private, no-store"}});}catch(e){return new Response(e.message||"Unable to load signed document",{status:502});}
  }
  if(url.pathname==="/internal/contact-status"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json().catch(()=>({}));const contact=await getSmsContactById(env,p.contactId||"").catch(()=>null)||await getDashboardContact(env,p.contactId||"").catch(()=>null);if(!contact)return Response.json({ok:false,error:"Contact not found"},{status:404});return Response.json({ok:true,contactId:contact.id||p.contactId,documentStatus:contact.documentStatus||"Not sent",selectedProduct:contact.selectedProduct||"",docusignEnvelopeId:contact.docusignEnvelopeId||"",deliveryStatus:contact.deliveryStatus||"Not scheduled",deliveryAt:contact.deliveryAt||"",calendarEventId:contact.calendarEventId||""});}
  if(url.pathname==="/internal/delivery-options"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{const p=await request.json().catch(()=>({}));const contact=await resolveContact(env,p.contactId||"",p);if(!contact?.id)return Response.json({ok:false,error:"Contact not found"},{status:404});if(String(contact.documentStatus||"").toLowerCase()!=="signed")return Response.json({ok:false,error:"Agreement must be signed before delivery scheduling"},{status:409});return Response.json({ok:true,contactId:contact.id,selectedProduct:contact.selectedProduct||"",...(await buildDeliveryOptions(env))});}catch(e){return Response.json({ok:false,error:e.message,googleCalendarConfigured:googleCalendarConfigured(env)},{status:502});}}
  if(url.pathname==="/internal/delivery-schedule"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{const result=await scheduleDelivery(env,await request.json().catch(()=>({})));return Response.json(result,{status:result.ok?200:result.conflict?409:400});}catch(e){return Response.json({ok:false,error:e.message,googleCalendarConfigured:googleCalendarConfigured(env)},{status:502});}}
  if(url.pathname==="/internal/leads"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const payload=await request.json(),method=preferredMethod(payload),contact=payload.contact||{},results={};if(contact.phone&&contact.id){try{results.smsSession={ok:await rememberSmsContact(env,contact)};}catch(e){results.smsSession={ok:false,error:e.message};}}results.email=contact.email?await callBinding(env.EMAIL,"https://email.internal/internal/send",payload):{ok:false,skipped:true};if(method==="Video")results.sms={ok:false,skipped:true,reason:"Live video selected"};else if(!smsConsentGranted(payload))results.sms={ok:false,skipped:true,reason:"SMS consent not granted"};else if(contact.phone){const message=method==="Phone"?`Hi ${contact.firstName||"there"}, I'm Buddy, your Buddy's personal shopping assistant. I received your request${contact.interest?` about ${contact.interest}`:""}. I'll call you in about 15 seconds. Reply STOP to opt out.`:`Hi ${contact.firstName||"there"}, I'm Buddy, your Buddy's personal shopping assistant. I received your request${contact.interest?` about ${contact.interest}`:""}. Would you like me to call you? Reply YES or CALL and I'll ring you. Reply STOP to opt out.`;results.sms=await callBinding(env.SMS,"https://sms.internal/internal/send",{...payload,messageType:method==="Phone"?"buddy-precall":"buddy-welcome",message});}else results.sms={ok:false,skipped:true};const contactFlow=method==="Phone"?"sms-then-call":method==="Text"?"sms-awaiting-call-reply":method==="Video"?"video-room":"email";if(method==="Phone"&&contact.phone){const delayed=(async()=>{await sleep(15000);try{await requestBuddyCall(env,contact,{type:"lead-form",preferredContactMethod:"Phone",delaySeconds:15});}catch(e){await updateDashboardContact(env,contact.id,{callStatus:"Call failed"});}})();if(ctx?.waitUntil)ctx.waitUntil(delayed);}await emit(env,{type:"lead.created",contactId:payload.contactId||contact.id||"",payload});return Response.json({ok:true,preferredContactMethod:method,contactFlow,results});}
  if(url.pathname==="/internal/sms-reply"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json(),reply=String(p.body||p.Body||p.message||"").trim(),from=p.from||p.From||p.phone||"",wantsCall=/^(yes|y|call|call me|yes please|please call|sure|ok|okay)\b/i.test(reply);let contact=null,source="none";try{contact=await getSmsContact(env,from);if(contact)source="d1-sms-session";}catch{}if(!contact){contact=await getDashboardContactByPhone(env,from);if(contact)source="dashboard-fallback";}console.log("Buddy SMS reply matched",{from,reply,wantsCall,matched:Boolean(contact),source,contactId:contact?.id||""});await emit(env,{type:"sms.reply",contactId:contact?.id||"",from,reply,wantsCall,source});if(!wantsCall)return Response.json({ok:true,action:"none",matched:Boolean(contact),source});if(!contact)return Response.json({ok:false,error:"No Buddy lead matched the replying phone number"},{status:404});try{return Response.json({ok:true,action:"call",contactId:contact.id,source,call:await requestBuddyCall(env,contact,{type:"sms-reply",reply,source})});}catch(e){await updateDashboardContact(env,contact.id,{callStatus:"Call failed"});return Response.json({ok:false,error:e.message,contactId:contact.id,source},{status:502});}}
  if(url.pathname==="/internal/calls"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json(),contact=p.contact||await getSmsContactById(env,p.contactId||"")||await getDashboardContact(env,p.contactId||"");if(!contact)return Response.json({ok:false,error:"Contact not found"},{status:404});try{return Response.json({ok:true,service:"voice",result:await requestBuddyCall(env,contact,p.trigger||{type:"manual"})});}catch(e){return Response.json({ok:false,service:"voice",error:e.message},{status:502});}}
  if(url.pathname==="/internal/video/session"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await requestBuddyVideoSession(env,await request.json().catch(()=>({}))));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/product-selected"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processProductSelection(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message,docusignConfigured:docusignConfigured(env)},{status:502});}}
  if(url.pathname==="/docusign/connect"&&request.method==="POST"){const contentType=request.headers.get("content-type")||"",payload=contentType.includes("json")?await request.json().catch(()=>({})):{raw:await request.text()},contactId=url.searchParams.get("contactId")||"",envelopeId=payload?.data?.envelopeId||payload?.envelopeId||"",status=String(payload?.data?.envelopeSummary?.status||payload?.status||payload?.event||"unknown");if(/completed/i.test(status)){await updateDashboardContact(env,contactId,{stage:"Docs Sent",documentStatus:"Signed",docusignEnvelopeId:envelopeId});const contact=await getSmsContactById(env,contactId).catch(()=>null)||await getDashboardContact(env,contactId).catch(()=>null);if(contact){const signed=await persistContact(env,contact,{stage:"Docs Sent",documentStatus:"Signed",docusignEnvelopeId:envelopeId||contact.docusignEnvelopeId});if(signed.smsConsent!==false&&signed.phone)await callBinding(env.SMS,"https://sms.internal/internal/send",{contactId,contact:signed,messageType:"buddy-docusign-signed",message:`Thanks${signed.firstName?`, ${signed.firstName}`:""}. We received your signed Buddy's agreement${signed.selectedProduct?` for the ${signed.selectedProduct}`:""}. Next, we'll set up your delivery. Reply STOP to opt out.`});if(signed.email)await callBinding(env.EMAIL,"https://email.internal/internal/send",{contactId,contact:signed,messageType:"buddy-docusign-signed",productName:signed.selectedProduct||""});}}await emit(env,{type:"docusign.webhook",contactId,envelopeId,status,payload});return Response.json({ok:true});}
  if(url.pathname==="/docusign/return"){
    const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buddy's - Documents Submitted</title></head><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:60px auto;padding:0 20px"><div style="background:#214b9f;color:#fff;padding:24px 28px;border-radius:14px 14px 0 0"><div style="font-size:26px;font-weight:800">Buddy's Home Furnishings</div><div style="margin-top:6px;opacity:.9">Documents submitted</div></div><div style="background:#fff;border:1px solid #d9e3f5;border-top:0;padding:30px;border-radius:0 0 14px 14px"><h2 style="margin:0 0 14px;color:#214b9f">We received your documentation.</h2><p style="font-size:16px;line-height:1.55">Please wait for the confirmation text message saying that Buddy has received your signed documents before returning to the call.</p><div style="margin:22px 0;padding:16px;background:#f5f8ff;border:1px solid #cfdcf5;border-radius:10px;font-weight:700">The confirmation usually arrives in about 30 seconds.</div><p style="font-size:16px;line-height:1.55;margin-bottom:0">Once that text arrives, return to the conversation and Buddy will continue with delivery scheduling.</p></div></div></body></html>`;
    return new Response(html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }
  return Response.json({ok:false,error:"Route not found"},{status:404});
}};
