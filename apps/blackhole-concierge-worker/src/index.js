import { verifyConnect } from "./connect-auth.js";
import operatorAuth from "../../dashboard/shared/services/operator-auth.js";
import { createBuddySigningSession, docusignConfigured } from "./docusign.js";
import { createSigningShortLink, resolveSigningShortLink } from "./docusign-links.js";
import { fetchSignedEnvelopePdf } from "./docusign-document.js";
import { rememberSmsContact, getSmsContact, getSmsContactById } from "./sms-session.js";
import { createDeliveryEvent, googleCalendarConfigured, googleCalendarTimeZone, isSlotAvailable } from "./google-calendar.js";

async function bindingValue(binding,max=5000){
  const value=binding&&typeof binding.get==="function"?await binding.get():binding;
  return String(value||"").trim().slice(0,max);
}

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
function operatorAuthRole(user){return ["admin","agent","viewer"].includes(user?.role);}
function preferredMethod(payload={}) { return String(payload.contact?.preferredContactMethod||payload.lead?.contact_method||payload.lead?.preferredContactMethod||"").trim(); }
function smsConsentGranted(payload={}) { const v=payload.contact?.smsConsent??payload.lead?.consent; return v===true||v==="true"||v==="on"; }
function normalizePhone(v="") { return String(v||"").replace(/\D/g,"").replace(/^1(?=\d{10}$)/,""); }
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function callBinding(env,binding,url,payload){
  if(!binding) return {ok:false,error:"Binding not configured"};
  try{
    const response=await binding.fetch(new Request(url,{method:"POST",headers:{"Content-Type":"application/json","x-internal-call-secret":env.INTERNAL_CALL_SECRET||""},body:JSON.stringify(payload)}));
    const text=await response.text(); let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    return response.ok&&data.ok===true?data:{...data,ok:false,status:response.status,error:data.error||"Provider did not confirm acceptance"};
  }catch(e){return {ok:false,error:e.message};}
}
async function emit(env,event){
  if(env.EVENTS&&!String(event.type||"").startsWith("buddy.product.selected")){try{await env.EVENTS.send({...event,ts:Date.now()});}catch{}}
  if(env.ANALYTICS){try{env.ANALYTICS.writeDataPoint({blobs:[event.type||"concierge.event",event.contactId||"",event.envelopeId||""],doubles:[Date.now()]});}catch{}}
}
async function listDashboardContacts(env){
  const base=String(env.DASHBOARD_URL||"").replace(/\/$/,""); if(!base)return[];
  const response=await fetch(`${base}/api/contacts`,{headers:{"x-internal-call-secret":env.INTERNAL_CALL_SECRET||""}}); if(!response.ok)return[];
  const body=await response.json().catch(()=>({})); const rows=Array.isArray(body)?body:body?.data||body?.contacts||body?.rows||[];
  return Array.isArray(rows)?rows:[];
}
async function getDashboardContact(env,id){if(env.DASHBOARD_MANAGED)return env.DASHBOARD_CONTACT?.id===id?env.DASHBOARD_CONTACT:null;const rows=await listDashboardContacts(env);return rows.find(c=>c?.id===id)||null;}
async function getDashboardContactByPhone(env,phone){const target=normalizePhone(phone);if(!target)return null;const rows=await listDashboardContacts(env);return [...rows].reverse().find(c=>normalizePhone(c?.phone)===target)||null;}
async function updateDashboardContact(env,id,patch){
  if(env.DASHBOARD_MANAGED){if(id!==env.DASHBOARD_CONTACT?.id)return null;Object.assign(env.DASHBOARD_PATCH,patch);return {...env.DASHBOARD_CONTACT,...env.DASHBOARD_PATCH};}
  if(!id)return null;const base=String(env.DASHBOARD_URL||"").replace(/\/$/,"");if(!base)return null;
  const response=await fetch(`${base}/api/contacts/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":"application/json","x-internal-call-secret":env.INTERNAL_CALL_SECRET||""},body:JSON.stringify(patch)});
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

function runtimeReadinessCacheRequest(config){
  return new Request(`https://buddy-runtime-readiness.internal/${encodeURIComponent(config.voiceId)}?base=${encodeURIComponent(config.baseUrl)}`);
}

async function cachedRuntimeReadiness(config){
  if(typeof caches==="undefined"||!caches?.default)return null;
  try{
    const response=await caches.default.match(runtimeReadinessCacheRequest(config));
    if(!response)return null;
    const value=await response.json().catch(()=>null);
    return value?.ok===true?{...value,cached:true}:null;
  }catch{return null;}
}

async function cacheRuntimeReadiness(config,value){
  if(typeof caches==="undefined"||!caches?.default||value?.ok!==true)return;
  try{
    await caches.default.put(runtimeReadinessCacheRequest(config),new Response(JSON.stringify(value),{
      headers:{"content-type":"application/json","cache-control":"public, max-age=300"},
    }));
  }catch{}
}

async function getBuddyRuntimeReadiness(env){
  const config=buddyRuntimeConfig(env);
  const cached=await cachedRuntimeReadiness(config);
  if(cached)return cached;
  const started=Date.now();
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
  const readiness={
    ok:errors.length===0,
    baseUrl:config.baseUrl,
    voiceId:config.voiceId,
    llm:{provider:health?.llm?.provider||"",model:health?.llm?.model||""},
    tts:{backend:health?.tts?.backend||"",device:health?.tts?.device||"",availableVoices,preparedVoices},
    checkMs:Date.now()-started,
    cached:false,
    errors,
  };
  await cacheRuntimeReadiness(config,readiness);
  return readiness;
}

function buddyProductOptions(interest=""){
  const value=String(interest||"").toLowerCase();
  const category=value||"home furnishings";
  if(/smart\s*phone|phone|mobile|iphone|android/.test(value))return[
    {id:"smartphone-iphone-16-pro",name:"Apple iPhone 16 Pro",category:"Smartphones"},
    {id:"smartphone-galaxy-s25-ultra",name:"Samsung Galaxy S25 Ultra",category:"Smartphones"},
  ];
  if(/tv|television|electronics/.test(value))return[
    {id:"tv-65-oled",name:"65-inch OLED 4K Smart TV",category:"Electronics"},
    {id:"tv-75-qled",name:"75-inch QLED 4K Smart TV",category:"Electronics"},
  ];
  if(/mattress|bed/.test(value))return[
    {id:"mattress-hybrid-queen",name:"Queen Hybrid Comfort Mattress",category:"Mattresses"},
    {id:"mattress-memory-queen",name:"Queen Memory Foam Mattress",category:"Mattresses"},
  ];
  if(/sofa|couch|living|furniture/.test(value))return[
    {id:"living-reclining-sofa",name:"Power Reclining Sofa",category:"Living Room"},
    {id:"living-sectional",name:"Modular Sectional Sofa",category:"Living Room"},
  ];
  if(/washer|dryer|refrigerator|appliance/.test(value))return[
    {id:"appliance-laundry-pair",name:"Smart Washer and Dryer Pair",category:"Appliances"},
    {id:"appliance-french-door",name:"French Door Refrigerator",category:"Appliances"},
  ];
  if(/computer|laptop|gaming/.test(value))return[
    {id:"computer-gaming-laptop",name:"Performance Gaming Laptop",category:"Computers"},
    {id:"computer-all-in-one",name:"27-inch All-in-One Computer",category:"Computers"},
  ];
  return[
    {id:"buddy-option-one",name:`Buddy's ${category} Option One`,category},
    {id:"buddy-option-two",name:`Buddy's ${category} Option Two`,category},
  ];
}

function buddyWorkflowState(contact={},productOptions=[]){
  const documentStatus=String(contact.documentStatus||"Not sent").trim();
  const deliveryStatus=String(contact.deliveryStatus||"Not scheduled").trim();
  const selectedProduct=String(contact.selectedProduct||"").trim();
  const firstName=String(contact.firstName||"there").trim()||"there";
  const deliveryComplete=Boolean(contact.deliveryAt)||["scheduled","completed"].includes(deliveryStatus.toLowerCase());
  const documentSigned=["signed","completed"].includes(documentStatus.toLowerCase());
  const documentSent=Boolean(contact.docusignEnvelopeId)||["sent","delivered"].includes(documentStatus.toLowerCase());

  if(deliveryComplete){
    return{
      phase:"complete",productOptions,selectedProduct,documentStatus,deliveryStatus,
      deliveryAt:contact.deliveryAt||"",calendarEventUrl:contact.calendarEventUrl||"",
      resumePrompt:`Resume the existing call with ${firstName}. Delivery is already scheduled${contact.deliveryAt?` for ${contact.deliveryAt}`:""}. Confirm that briefly and end with a warm goodbye. Do not offer products again.`,
    };
  }
  if(documentSigned){
    return{
      phase:"awaiting-delivery",productOptions,selectedProduct,documentStatus,deliveryStatus,
      signingUrl:contact.signingShortUrl||"",
      resumePrompt:`Resume the existing call with ${firstName}. The agreement${selectedProduct?` for ${selectedProduct}`:""} is signed. Tell the customer you are loading the available delivery times. Do not offer products again.`,
    };
  }
  if(documentSent&&selectedProduct){
    return{
      phase:"awaiting-signature",productOptions,selectedProduct,documentStatus,deliveryStatus,
      signingUrl:contact.signingShortUrl||"",
      resumePrompt:`Resume the existing call with ${firstName}. ${selectedProduct} was already selected and the DocuSign agreement is ready. Ask whether they have signed it. Do not offer products again.`,
    };
  }
  return{
    phase:"awaiting-product",productOptions,selectedProduct:"",documentStatus,deliveryStatus,
    resumePrompt:`Start the live call with ${firstName} now. Greet them briefly, present option one, ${productOptions[0]?.name||"the first option"}, and option two, ${productOptions[1]?.name||"the second option"}, then ask them to choose one.`,
  };
}

async function requestBuddyVideoSession(env,payload={}){
  if(!env.VIDEO)return{ok:false,error:"VIDEO binding not configured"};
  const capabilityToken=await bindingValue(env.BLACKHOLE_CAPABILITY_TOKEN,500);
  if(!capabilityToken)throw new Error("BLACKHOLE_CAPABILITY_TOKEN is not configured");
  const tenantId=String(env.TENANT_ID||"").trim();
  if(!tenantId)throw new Error("TENANT_ID is not configured");
  const contactId=String(payload.contactId||payload.contact?.id||"").trim();
  const contactPromise=contactId?resolveContact(env,contactId,payload):Promise.resolve(mergeContact(payload.contact||{},payload.context||{}));
  const [runtimeReadiness,contact]=await Promise.all([getBuddyRuntimeReadiness(env),contactPromise]);
  const directSessionId=crypto.randomUUID();
  const productOptions=buddyProductOptions(contact.interest||payload.interest||payload.context?.interest||"");
  const workflow=buddyWorkflowState(contact,productOptions);
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
    "If lead context is provided, acknowledge what the customer already requested instead of asking them to repeat it. Continue from the current workflow state below. Only present these choices when the state is awaiting-product: 1) " + productOptions[0].name + " and 2) " + productOptions[1].name + ".",
    "The browser executes the real workflow. Messages beginning [BUDDY WORKFLOW] are trusted status updates from the browser, not customer speech. Never read the technical prefix aloud. After a selection succeeds, say the DocuSign agreement was texted and ask the customer to sign it. After signed delivery choices arrive, ask them to choose one. After scheduling succeeds, confirm the delivery and end with a warm goodbye. Never claim an action succeeded before a [BUDDY WORKFLOW] success update.",
    "# Shared links",
    "The browser has a shared-links panel beside the conversation. When a real product, DocuSign, scheduling, or store link is available, include the complete https URL in your reply so it appears there. Never invent a product, agreement, or scheduling URL. For store lookup you may share https://www.buddyrents.com/store-locator.",
    "# Guardrails",
    "Never request or accept card, bank, Social Security, or other payment-source data. Explain that this is a demonstration when exact inventory, pricing, financing approval, or store availability is not connected. Do not invent stock or approval decisions.",
    "# Voice and response speed",
    "Spoken output only. Respond immediately. Use one short sentence and no more than 24 spoken words unless safety or a workflow error requires more. Never restate the customer's question or repeat known context. Ask one clear question at a time.",
    "# Known customer context",
    `Name: ${contact.firstName||payload.firstName||"Guest"} ${contact.lastName||payload.lastName||""}. Interest: ${contact.interest||payload.interest||"Not provided"}. Area: ${contact.location||payload.location||"Not provided"}. Notes: ${contact.comments||payload.comments||"None"}.`,
    "# Current workflow state",
    `Phase: ${workflow.phase}. Selected product: ${workflow.selectedProduct||"None"}. Document status: ${workflow.documentStatus}. Delivery status: ${workflow.deliveryStatus}.`,
    "# Reminder",
    "You are Buddy in a live browser video conversation. Use the known context, keep replies natural, and never ask for payment details."
  ].join("\n\n").slice(0,5000);
  const upstream=await env.VIDEO.fetch(new Request("https://blackhole.internal/internal/video/session",{
    method:"POST",
    headers:{"content-type":"application/json","x-blackhole-capability-token":capabilityToken},
    body:JSON.stringify({
      tenantId,
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
    await Promise.all([
      persistContact(env,contact,{stage:"Engaged",callStatus:"Video session created"}),
      updateDashboardContact(env,contactId,{stage:"Engaged",callStatus:"Video session created"}),
    ]);
  }
  await emit(env,{type:"video.session.created",contactId,room:data.room||"",dispatchId:data.dispatchId||"",source:payload.source||"buddy-web"});
  return{ok:true,...data,contactId:contactId||undefined,workflow,runtime:{ok:runtimeReadiness.ok,requiredForSession:false,adapter:"buddy-concierge",voiceId:runtimeReadiness.voiceId,llm:runtimeReadiness.llm,errors:runtimeReadiness.errors||[]}};
}

async function processProductSelection(env,payload={}){
  const contactId=payload.contactId||payload.contact?.id||"";
  let contact=await resolveContact(env,contactId,payload);
  const optionIndex=Number(payload.optionIndex);
  const option=Number.isInteger(optionIndex)?buddyProductOptions(contact.interest||payload.category||"")[optionIndex]:null;
  let product=option||{id:payload.productId||payload.product?.id||"",name:payload.productName||payload.product?.name||"",category:payload.category||contact.interest||""};
  const selectionNumber=option?optionIndex+1:Number(payload.selectionNumber||1);
  if(!contact.phone||!contact.email)throw new Error("A phone and email are required for agreement delivery");
  let docusign;
  const alreadyCreated=Boolean(contact.docusignEnvelopeId);
  if(alreadyCreated){
    product={id:contact.selectedProductId||product.id,name:contact.selectedProduct||product.name,category:product.category};
    docusign={envelopeId:contact.docusignEnvelopeId,agreementId:contact.agreementId,shortSigningUrl:contact.signingShortUrl};
    if(!docusign.shortSigningUrl)throw new Error("Agreement exists without a signing link; operator recovery required");
  }else{
    if(!await bindingValue(env.DOCUSIGN_CONNECT_HMAC_SECRET))throw new Error("DocuSign Connect verification is not configured");
    docusign=await createBuddySigningSession(env,{contact,product,selectionNumber,contactId});
    const shortSigningUrl=await createSigningShortLink(env,{targetUrl:docusign.signingUrl,contactId,envelopeId:docusign.envelopeId});
    docusign.shortSigningUrl=shortSigningUrl;
    // Persist provider identity before sending; retries reuse this envelope.
    contact={...contact,stage:"Docs Sent",selectedProduct:product.name,selectedProductId:product.id,selectionNumber,docusignEnvelopeId:docusign.envelopeId,agreementId:docusign.agreementId,documentStatus:"Created",signingShortUrl:shortSigningUrl};
    if(!await rememberSmsContact(env,contact))throw new Error("Agreement created but workflow persistence failed; operator recovery required");
  }
  let sms=contact.smsConsent===false?{ok:false,skipped:true}:{ok:true,alreadySent:true};
  if(!contact.agreementSmsSent&&contact.smsConsent!==false){
    sms=await callBinding(env,env.SMS,"https://sms.internal/internal/send",{contactId,contact,messageType:"buddy-docusign",message:`Your Buddy's agreement for ${product.name} is ready. Sign here: ${docusign.shortSigningUrl} Reply STOP to opt out.`,docusign,product});
    if(sms.ok){contact.agreementSmsSent=true;await rememberSmsContact(env,contact);}
  }
  let email={ok:true,alreadySent:true};
  if(!contact.agreementEmailSent){
    email=await callBinding(env,env.EMAIL,"https://email.internal/internal/send",{contactId,contact,messageType:"buddy-docusign",docusign,product});
    if(email.ok){contact.agreementEmailSent=true;await rememberSmsContact(env,contact);}
  }
  const delivered=(sms.ok||sms.skipped)&&email.ok;
  const patch={selectedProduct:product.name,selectedProductId:product.id,docusignEnvelopeId:docusign.envelopeId,agreementId:docusign.agreementId,signingShortUrl:docusign.shortSigningUrl,
    documentStatus:String(contact.documentStatus).toLowerCase()==="signed"?"Signed":(contact.agreementSmsSent||contact.agreementEmailSent?"Sent":"Created"),
    agreementDeliveryStatus:delivered?"Accepted":"Retry required"};
  await rememberSmsContact(env,{...contact,...patch});
  if(!await updateDashboardContact(env,contactId,patch))throw new Error("Agreement state saved; dashboard update requires retry");
  await emit(env,{type:delivered?"docusign.sent":"docusign.delivery.failed",contactId,envelopeId:docusign.envelopeId,productName:product.name});
  return{ok:delivered,alreadyCreated,contactId,product,docusign,sms,email,...(!delivered?{error:"Agreement created, but message delivery failed. Retry to send only the missing messages."}:{})};
}

async function scheduleDelivery(env,payload={}){
  const contactId=payload.contactId||"",contact=await resolveContact(env,contactId,payload);if(!contactId||!contact?.id)throw new Error("Delivery scheduling requires a valid contact");if(String(contact.documentStatus||"").toLowerCase()!=="signed")throw new Error("Agreement must be signed before delivery scheduling");if(contact.deliveryAt)return {ok:true,alreadyScheduled:true,contactId,delivery:{id:contact.calendarEventId,start:contact.deliveryAt,end:contact.deliveryEnd,htmlLink:contact.calendarEventUrl}};if(!googleCalendarConfigured(env))throw new Error("Google Calendar is not configured");
  const startIso=String(payload.startIso||payload.start||"");if(!startIso||Number.isNaN(new Date(startIso).getTime()))throw new Error("A valid delivery start time is required");const durationMinutes=Math.max(30,Number(payload.durationMinutes||120));const endIso=String(payload.endIso||new Date(new Date(startIso).getTime()+durationMinutes*60000).toISOString());if(!(await isSlotAvailable(env,startIso,endIso)))return{ok:false,conflict:true,error:"That delivery slot is no longer available"};
  const product={name:contact.selectedProduct||contact.interest||"Buddy's order"};const calendar=await createDeliveryEvent(env,{contact,product,startIso,endIso,timeZone:payload.timeZone||googleCalendarTimeZone(env),contactId});const timeZone=calendar.timeZone||googleCalendarTimeZone(env),deliveryLabel=formatDeliverySlot(calendar.start,timeZone);
  const scheduled=await persistContact(env,contact,{stage:"Scheduled",callStatus:"Call completed",deliveryAt:calendar.start,deliveryEnd:calendar.end,deliveryStatus:"Scheduled",calendarEventId:calendar.id,calendarEventUrl:calendar.htmlLink});
  await updateDashboardContact(env,contactId,{stage:"Scheduled",callStatus:"Call completed",deliveryAt:calendar.start,deliveryEnd:calendar.end,deliveryStatus:"Scheduled",calendarEventId:calendar.id,calendarEventUrl:calendar.htmlLink});
  let sms={ok:false,skipped:true};if(scheduled.smsConsent!==false&&scheduled.phone)sms=await callBinding(env,env.SMS,"https://sms.internal/internal/send",{contactId,contact:scheduled,messageType:"buddy-delivery-confirmed",message:`You're scheduled${scheduled.firstName?`, ${scheduled.firstName}`:""}. Buddy's delivery for ${product.name} is set for ${deliveryLabel}. Reply STOP to opt out.`,delivery:{...calendar,label:deliveryLabel},product});
  const email=scheduled.email?await callBinding(env,env.EMAIL,"https://email.internal/internal/send",{contactId,contact:scheduled,messageType:"buddy-delivery-confirmed",delivery:{...calendar,label:deliveryLabel},product}):{ok:false,skipped:true};
  await emit(env,{type:"delivery.scheduled",contactId,calendarEventId:calendar.id,deliveryAt:calendar.start,productName:product.name});return{ok:true,contactId,delivery:{...calendar,label:deliveryLabel},sms,email};
}

async function handleRequest(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==="/api/health")return Response.json({ok:true,service:"buddys-concierge-worker",health:"online",runtime:"edge",docusign:docusignConfigured(env)?"configured":"not-configured",googleCalendar:googleCalendarConfigured(env)?"configured":"not-configured",googleCalendarTimeZone:googleCalendarTimeZone(env)});
  if(url.pathname==="/api/video/readiness"){
    const runtime=await getBuddyRuntimeReadiness(env);
    const brokerConfigured=Boolean(env.VIDEO&&typeof env.VIDEO.fetch==="function");
    const capabilityConfigured=Boolean(await bindingValue(env.BLACKHOLE_CAPABILITY_TOKEN,500));
    const ok=brokerConfigured&&capabilityConfigured;
    return Response.json({
      ok,
      service:"buddys-live-video",
      adapter:"buddy-concierge",
      tenantId:String(env.TENANT_ID||""),
      runtimeTarget:String(env.RUNTIME_TARGET||""),
      runtimeRequiredForSession:false,
      brokerConfigured,
      capabilityConfigured,
      runtime,
      warnings:runtime.ok?[]:(runtime.errors||[]).map(error=>`public Buddy runtime advisory: ${error}`),
      next:ok?"ready through Buddy's standalone tenant adapter":"configure Buddy's VIDEO binding and capability token",
    },{status:ok?200:503});
  }
  if(url.pathname==="/docusign/consent-complete")return new Response("DocuSign consent granted. You can close this tab and return to Buddy.",{status:200,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  if(url.pathname.startsWith("/docusign/sign/")&&request.method==="GET"){const token=decodeURIComponent(url.pathname.slice("/docusign/sign/".length));const row=await resolveSigningShortLink(env,token).catch(()=>null);if(!row?.target_url)return new Response("This signing link is unavailable.",{status:404});return Response.redirect(String(row.target_url),302);}
  if(url.pathname.startsWith("/docusign/document/")&&request.method==="GET"){
    const internal=await operatorAuth.equalSecret(request.headers.get("x-internal-call-secret"),env.INTERNAL_CALL_SECRET);
    const operator=internal?null:await operatorAuth.identity(Object.fromEntries(request.headers),env);
    if(!internal&&!operatorAuthRole(operator))return new Response("Unauthorized",{status:401});
    const contactId=decodeURIComponent(url.pathname.slice("/docusign/document/".length));const contact=await getSmsContactById(env,contactId).catch(()=>null);if(!contact?.docusignEnvelopeId)return new Response("Signed document not found.",{status:404});
    try{const pdf=await fetchSignedEnvelopePdf(env,contact.docusignEnvelopeId);const name=`Buddy-Agreement-${contact.firstName||"customer"}-${contact.lastName||""}.pdf`.replace(/[^A-Za-z0-9._-]+/g,"-");return new Response(pdf,{status:200,headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename=\"${name}\"`,"Cache-Control":"private, no-store"}});}catch(e){return new Response(e.message||"Unable to load signed document",{status:502});}
  }
  if(url.pathname==="/internal/contact-status"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json().catch(()=>({}));const contact=await getSmsContactById(env,p.contactId||"").catch(()=>null)||await getDashboardContact(env,p.contactId||"").catch(()=>null);if(!contact)return Response.json({ok:false,error:"Contact not found"},{status:404});return Response.json({ok:true,contactId:contact.id||p.contactId,documentStatus:contact.documentStatus||"Not sent",selectedProduct:contact.selectedProduct||"",docusignEnvelopeId:contact.docusignEnvelopeId||"",signingShortUrl:contact.signingShortUrl||"",deliveryStatus:contact.deliveryStatus||"Not scheduled",deliveryAt:contact.deliveryAt||"",calendarEventId:contact.calendarEventId||"",calendarEventUrl:contact.calendarEventUrl||""});}
  if(url.pathname==="/internal/delivery-options"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{const p=await request.json().catch(()=>({}));const contact=await resolveContact(env,p.contactId||"",p);if(!contact?.id)return Response.json({ok:false,error:"Contact not found"},{status:404});if(String(contact.documentStatus||"").toLowerCase()!=="signed")return Response.json({ok:false,error:"Agreement must be signed before delivery scheduling"},{status:409});return Response.json({ok:true,contactId:contact.id,selectedProduct:contact.selectedProduct||"",...(await buildDeliveryOptions(env))});}catch(e){return Response.json({ok:false,error:e.message,googleCalendarConfigured:googleCalendarConfigured(env)},{status:502});}}
  if(url.pathname==="/internal/delivery-schedule"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{const result=await scheduleDelivery(env,await request.json().catch(()=>({})));return Response.json(result,{status:result.ok?200:result.conflict?409:400});}catch(e){return Response.json({ok:false,error:e.message,googleCalendarConfigured:googleCalendarConfigured(env)},{status:502});}}
  if(url.pathname==="/internal/leads"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const payload=await request.json(),method=preferredMethod(payload),contact=payload.contact||{},results={};if(contact.phone&&contact.id){try{results.smsSession={ok:await rememberSmsContact(env,contact)};}catch(e){results.smsSession={ok:false,error:e.message};}}results.email=contact.email?await callBinding(env,env.EMAIL,"https://email.internal/internal/send",payload):{ok:false,skipped:true};if(!smsConsentGranted(payload))results.sms={ok:false,skipped:true,reason:"SMS consent not granted"};else if(contact.phone){const message=method==="Phone"?`Hi ${contact.firstName||"there"}, I'm Buddy, your Buddy's personal shopping assistant. I received your request${contact.interest?` about ${contact.interest}`:""}. I'll call you in about 15 seconds. Reply STOP to opt out.`:method==="Video"?`Hi ${contact.firstName||"there"}, I'm Buddy, your Buddy's personal shopping assistant. Your live video room is ready${contact.interest?` for ${contact.interest}`:""}. After our chat, reply CALL if you'd like me to ring you. Reply STOP to opt out.`:`Hi ${contact.firstName||"there"}, I'm Buddy, your Buddy's personal shopping assistant. I received your request${contact.interest?` about ${contact.interest}`:""}. Would you like me to call you? Reply YES or CALL and I'll ring you. Reply STOP to opt out.`;results.sms=await callBinding(env,env.SMS,"https://sms.internal/internal/send",{...payload,messageType:method==="Phone"?"buddy-precall":method==="Video"?"buddy-video-welcome":"buddy-welcome",message});}else results.sms={ok:false,skipped:true};const contactFlow=method==="Message"?"web-chat":method==="Phone"?"sms-then-call":method==="Text"?"sms-awaiting-call-reply":method==="Video"?"video-room-plus-sms":"email";if(method==="Phone"&&contact.phone){const delayed=(async()=>{await sleep(15000);const backgroundEnv={...env,DASHBOARD_MANAGED:false};try{await requestBuddyCall(backgroundEnv,contact,{type:"lead-form",preferredContactMethod:"Phone",delaySeconds:15});}catch(e){await updateDashboardContact(backgroundEnv,contact.id,{callStatus:"Call failed"});}})();if(ctx?.waitUntil)ctx.waitUntil(delayed);}await emit(env,{type:"lead.created",contactId:payload.contactId||contact.id||"",payload});return Response.json({ok:true,preferredContactMethod:method,contactFlow,results});}
  if(url.pathname==="/internal/sms-reply"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json(),reply=String(p.body||p.Body||p.message||"").trim(),from=p.from||p.From||p.phone||"",wantsCall=/^(yes|y|call|call me|yes please|please call|sure|ok|okay)\b/i.test(reply);let contact=null,source="none";try{contact=await getSmsContact(env,from);if(contact)source="d1-sms-session";}catch{}if(!contact){contact=await getDashboardContactByPhone(env,from);if(contact)source="dashboard-fallback";}console.log("Buddy SMS reply matched",{from,reply,wantsCall,matched:Boolean(contact),source,contactId:contact?.id||""});await emit(env,{type:"sms.reply",contactId:contact?.id||"",from,reply,wantsCall,source});if(!wantsCall)return Response.json({ok:true,action:"none",matched:Boolean(contact),source});if(!contact)return Response.json({ok:false,error:"No Buddy lead matched the replying phone number"},{status:404});try{return Response.json({ok:true,action:"call",contactId:contact.id,source,call:await requestBuddyCall(env,contact,{type:"sms-reply",reply,source})});}catch(e){await updateDashboardContact(env,contact.id,{callStatus:"Call failed"});return Response.json({ok:false,error:e.message,contactId:contact.id,source},{status:502});}}
  if(url.pathname==="/internal/calls"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;const p=await request.json(),contact=p.contact||await getSmsContactById(env,p.contactId||"")||await getDashboardContact(env,p.contactId||"");if(!contact)return Response.json({ok:false,error:"Contact not found"},{status:404});try{return Response.json({ok:true,service:"voice",result:await requestBuddyCall(env,contact,p.trigger||{type:"manual"})});}catch(e){return Response.json({ok:false,service:"voice",error:e.message},{status:502});}}
  // Business state only: media creation belongs to the sealed tenant adapter.
  if(url.pathname==="/internal/video/context"&&request.method==="POST"){
    const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;
    try{
      const payload=await request.json();
      const contactId=String(payload.contactId||"").trim();
      const contact=contactId?await resolveContact(env,contactId,payload):mergeContact(payload.contact||{},payload.context||{});
      return Response.json({ok:true,contactId,workflow:buddyWorkflowState(contact,buddyProductOptions(contact.interest||""))});
    }catch(e){return Response.json({ok:false,error:e.message},{status:502});}
  }
  if(url.pathname==="/internal/video/session"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await requestBuddyVideoSession(env,await request.json().catch(()=>({}))));}catch(e){return Response.json({ok:false,error:e.message},{status:502});}}
  if(url.pathname==="/internal/product-selected"&&request.method==="POST"){const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;try{return Response.json(await processProductSelection(env,await request.json()));}catch(e){return Response.json({ok:false,error:e.message,docusignConfigured:docusignConfigured(env)},{status:502});}}
  if(url.pathname==="/docusign/connect"&&request.method==="POST"){
    const raw=await request.arrayBuffer();
    if(!await verifyConnect(request,raw,env))return Response.json({ok:false,error:"Invalid Connect signature"},{status:401});
    let payload;try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return Response.json({ok:false,error:"Invalid Connect JSON"},{status:400});}
    const contactId=url.searchParams.get("contactId")||"";
    const envelopeId=String(payload?.data?.envelopeId||payload?.envelopeId||"");
    const status=String(payload?.data?.envelopeSummary?.status||payload?.status||payload?.event||"").toLowerCase();
    const contact=await getSmsContactById(env,contactId).catch(()=>null)||await getDashboardContact(env,contactId).catch(()=>null);
    if(!contact||!envelopeId||envelopeId!==contact.docusignEnvelopeId)return Response.json({ok:false,error:"Envelope/contact mismatch"},{status:403});
    if(!["completed","envelope-completed"].includes(status))return Response.json({ok:true,ignored:true});
    if(!env.DB)return Response.json({ok:false,error:"Connect persistence unavailable"},{status:503});
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS buddy_connect_receipts (envelope_id TEXT PRIMARY KEY, completed_at INTEGER, lease_until INTEGER NOT NULL, sms_done INTEGER DEFAULT 0, email_done INTEGER DEFAULT 0)").run();
    // A unique row prevents concurrent/replayed callbacks from reapplying completion.
    const claim=await env.DB.prepare("INSERT INTO buddy_connect_receipts (envelope_id, lease_until) VALUES (?, ?) ON CONFLICT(envelope_id) DO UPDATE SET lease_until = excluded.lease_until WHERE completed_at IS NULL AND lease_until < ?").bind(envelopeId,Date.now()+60000,Date.now()).run();
    if(Number(claim.meta?.changes??claim.changes)===0){
      const receipt=await env.DB.prepare("SELECT completed_at FROM buddy_connect_receipts WHERE envelope_id = ?").bind(envelopeId).first();
      return receipt?.completed_at?Response.json({ok:true,duplicate:true}):Response.json({ok:false,error:"Callback processing; retry required"},{status:503});
    }
    try{
      const patch={documentStatus:"Signed"};
      // Preserve Scheduled/Completed stage when a provider retries a late callback.
      const updated=await updateDashboardContact(env,contactId,patch);
      if(!updated)throw new Error("Dashboard update failed");
      await rememberSmsContact(env,{...contact,...patch});
      const receipt=await env.DB.prepare("SELECT sms_done, email_done FROM buddy_connect_receipts WHERE envelope_id = ?").bind(envelopeId).first();
      if(!receipt.sms_done&&contact.smsConsent!==false&&contact.phone){
        const sent=await callBinding(env,env.SMS,"https://sms.internal/internal/send",{contactId,contact:{...contact,...patch},messageType:"buddy-docusign-signed",message:`Thanks${contact.firstName?`, ${contact.firstName}`:""}. We received your signed Buddy's agreement. Next, we'll set up your delivery. Reply STOP to opt out.`});
        if(!sent.ok)throw new Error("Signed agreement SMS failed");
        await env.DB.prepare("UPDATE buddy_connect_receipts SET sms_done = 1 WHERE envelope_id = ?").bind(envelopeId).run();
      }
      if(!receipt.email_done&&contact.email){
        const sent=await callBinding(env,env.EMAIL,"https://email.internal/internal/send",{contactId,contact:{...contact,...patch},messageType:"buddy-docusign-signed",productName:contact.selectedProduct||""});
        if(!sent.ok)throw new Error("Signed agreement email failed");
        await env.DB.prepare("UPDATE buddy_connect_receipts SET email_done = 1 WHERE envelope_id = ?").bind(envelopeId).run();
      }
      await env.DB.prepare("UPDATE buddy_connect_receipts SET completed_at = ? WHERE envelope_id = ?").bind(Date.now(),envelopeId).run();
      await emit(env,{type:"docusign.webhook",contactId,envelopeId,status});
      return Response.json({ok:true});
    }catch{
      await env.DB.prepare("UPDATE buddy_connect_receipts SET lease_until = 0 WHERE envelope_id = ?").bind(envelopeId).run();
      return Response.json({ok:false,error:"Unable to persist signed agreement; retry required"},{status:503});
    }
  }
  if(url.pathname==="/docusign/return"){
    const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buddy's - Documents Submitted</title></head><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:60px auto;padding:0 20px"><div style="background:#214b9f;color:#fff;padding:24px 28px;border-radius:14px 14px 0 0"><div style="font-size:26px;font-weight:800">Buddy's Home Furnishings</div><div style="margin-top:6px;opacity:.9">Documents submitted</div></div><div style="background:#fff;border:1px solid #d9e3f5;border-top:0;padding:30px;border-radius:0 0 14px 14px"><h2 style="margin:0 0 14px;color:#214b9f">We received your documentation.</h2><p style="font-size:16px;line-height:1.55">Please wait for the confirmation text message saying that Buddy has received your signed documents before returning to the call.</p><div style="margin:22px 0;padding:16px;background:#f5f8ff;border:1px solid #cfdcf5;border-radius:10px;font-weight:700">The confirmation usually arrives in about 30 seconds.</div><p style="font-size:16px;line-height:1.55;margin-bottom:0">Once that text arrives, return to the conversation and Buddy will continue with delivery scheduling.</p></div></div></body></html>`;
    return new Response(html,{status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }
  return Response.json({ok:false,error:"Route not found"},{status:404});

}
export default { async fetch(request,env,ctx){
  if(request.headers.get("x-buddy-dashboard-managed")==="1"&&new URL(request.url).pathname.startsWith("/internal/")){
    const auth=await authorizeInternal(request,env);if(!auth.ok)return auth.response;
    const payload=await request.clone().json().catch(()=>({}));
    const scoped={...env,DASHBOARD_MANAGED:true,DASHBOARD_CONTACT:payload.contact,DASHBOARD_PATCH:{}};
    const response=await handleRequest(request,scoped,ctx);
    const data=await response.json();
    return Response.json({...data,contactPatch:scoped.DASHBOARD_PATCH},{status:response.status});
  }
  return handleRequest(request,env,ctx);
}};
