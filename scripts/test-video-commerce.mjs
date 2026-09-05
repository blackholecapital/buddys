// Runs real Pages, dashboard, concierge and tenant handlers with in-memory SQLite
// and stubbed provider/media edges. No credentials or external requests are used.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { onRequest } from '../apps/frontend/functions/api/[[path]].ts';
import concierge from '../apps/blackhole-concierge-worker/src/index.js';
import assistant from '../blackhole-runtime/src/index.js';
const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
const db = require('../apps/dashboard/backend/layers/core/db');
const store = require('../apps/dashboard/backend/layers/core/memory-store');
db.setBackend(store); store.reset();
const contacts = require('../apps/dashboard/backend/layers/domain/contacts');
const handlers = Object.fromEntries(['leads','video-session','video-action','video-transcript'].map(name => [name,require(`../apps/dashboard/backend/functions/api/${name}/index.js`)]));
const sqlite = new DatabaseSync(':memory:');
const d1 = { prepare(sql) {
  const statement = sqlite.prepare(sql); let args = [];
  return { bind(...values) { args = values; return this; }, async run() { return statement.run(...args); }, async first() { return statement.get(...args) || null; }, async all() { return { results:statement.all(...args) }; } };
} };
const sent = []; let mediaCalls = 0; let envelopeCalls = 0; let calendarCalls = 0;
let dashboardCallbacks = 0; let failAgreementEmail = true;
let failMedia = false; let malformedMedia = false;
const env = {
  DOCUSIGN_CONNECT_HMAC_SECRET:'test-connect-secret',
  INTERNAL_CALL_SECRET:'test-only-secret', DB:d1, BUDDY_DB:d1,
  DASHBOARD_URL:'https://dashboard.test', GOOGLE_ACCESS_TOKEN:'test-only',
  DOCUSIGN_INTEGRATION_KEY:'test-only', DOCUSIGN_USER_ID:'test-only', DOCUSIGN_ACCOUNT_ID:'test-only',
  DOCUSIGN_RSA_PRIVATE_KEY:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),
  SMS:{ async fetch(req) { sent.push(await req.json()); return Response.json({ok:true}); } },
  EMAIL:{ async fetch(req) { const message=await req.json(); sent.push(message); return Response.json({ok:!(failAgreementEmail&&message.messageType==='buddy-docusign')}); } },
};
const adapterEnv = {
  BLACKHOLE_CAPABILITY_TOKEN:'test-only-capability',
  ASSISTANT_ASSETS:{ async get() { return { async text() { return JSON.stringify({avatar:{url:'https://assets.test/buddy.png'}}); } }; } },
  VIDEO:{ async fetch(req) {
    mediaCalls++;
    assert.equal(req.headers.get('x-blackhole-capability-token'),'test-only-capability');
    const body = await req.json(); assert.equal(body.tenantId,'buddys'); assert.equal(body.creatorId,'buddy');
    assert.ok(body.fanId); assert.match(body.instructions,/Buddy/);
    if (failMedia) return Response.json({error:'broker unavailable'},{status:503});
    if (malformedMedia) return Response.json({ok:true});
    return Response.json({ok:true,livekitUrl:'wss://media.test',token:'test-media-token',room:'buddy-room',dispatchId:`session-${mediaCalls}`});
  } },
};
env.CONCIERGE = { fetch:req => concierge.fetch(req,env,{waitUntil(){}}) };
env.ASSISTANT = { async fetch(req) { const body=await req.clone().json(); assert.equal(body.metadata.userId,contactId); return assistant.fetch(req,adapterEnv); } };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input,options={}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin === 'https://dashboard.test') {
    dashboardCallbacks++; assert.equal(options.headers['x-internal-call-secret'],env.INTERNAL_CALL_SECRET);
    if (options.method === 'PUT') return Response.json(contacts.update(decodeURIComponent(url.pathname.split('/').pop()),JSON.parse(options.body)));
    return Response.json(db.readDb().contacts);
  }
  if (url.hostname === 'account-d.docusign.com') return Response.json({access_token:'test-oauth',expires_in:3600});
  if (url.hostname === 'demo.docusign.net' && url.pathname.endsWith('/envelopes')) { envelopeCalls++; return Response.json({envelopeId:'envelope-test',status:'sent'}); }
  if (url.hostname === 'demo.docusign.net' && url.pathname.endsWith('/views/recipient')) return Response.json({url:'https://sign.test/agreement'});
  if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/freeBusy')) return Response.json({calendars:{primary:{busy:[]}}});
  if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/events')) { calendarCalls++; const event=JSON.parse(options.body); return Response.json({...event,id:'delivery-test',htmlLink:'https://calendar.test/event'}); }
  throw new Error(`Unexpected external request: ${url}`);
};
const pagesEnv = { DASHBOARD:{ async fetch(req) {
  const route = new URL(req.url).pathname.slice('/api/'.length).replace('video/','video-');
  assert.ok(handlers[route],route);
  return Response.json(await handlers[route]({method:req.method,body:await req.json(),env}));
} } };
async function post(path,body) { return (await onRequest({request:new Request(`https://pages.test/api/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env:pagesEnv})).json(); }
let contactId; let customerToken;
try {
  const lead=await post('leads',{first_name:'Sam',last_name:'Test',phone:'+15555550123',email:'sam@example.test',product_interest:'Smartphones',preferred_store:'Orlando',comments:'Camera quality',consent:true});
  assert.equal(lead.ok,true); contactId=lead.contact.id; customerToken=lead.customerToken; assert.ok(customerToken);
  const session=await post('video/session',{customerToken,contactId,interest:'wrong-client-override'});
  assert.equal(session.ok,true,session.error); assert.ok(session.workflowToken); assert.equal(session.contactId,contactId);
  assert.equal(session.workflow.productOptions.length,2); assert.match(session.workflow.productOptions[0].name,/iPhone/);
  assert.match(session.workflow.resumePrompt,/Orlando/); assert.match(session.workflow.resumePrompt,/Camera quality/);
  const auth={contactId,sessionId:session.sessionId,workflowToken:session.workflowToken};
  assert.equal((await post('video/action',{...auth,action:'delivery-options'})).ok,false);
  assert.equal((await post('video/action',{...auth,action:'product-selected',optionIndex:2})).ok,false);
  assert.equal((await post('video/action',{...auth,workflowToken:'forged',action:'product-selected',optionIndex:0})).ok,false);
  assert.equal((await post('video/session',{contactId})).ok,false);
  const failedDelivery=await post('video/action',{...auth,action:'product-selected',optionIndex:0});
  assert.equal(failedDelivery.ok,false); assert.equal(envelopeCalls,1);
  failAgreementEmail=false;
  const selected=await post('video/action',{...auth,action:'product-selected',optionIndex:0});
  assert.equal(selected.ok,true,selected.error); assert.equal(envelopeCalls,1);
  assert.equal(sent.filter(m=>m.messageType==='buddy-docusign'&&m.message).length,1);
  assert.equal(dashboardCallbacks,0,'Dashboard BFF must not recursively call its locked API');
  assert.ok(sent.some(message=>message.messageType==='buddy-docusign'));
  assert.equal((await post('video/session',{customerToken,contactId})).workflow.phase,'awaiting-signature');
  assert.equal((await post('video/action',{...auth,action:'product-selected',optionIndex:0})).alreadyCreated,true);
  assert.equal(envelopeCalls,1);
  // Tampering and mismatched envelopes must not change document state.
  const callbackBody=JSON.stringify({envelopeId:'envelope-test',status:'completed'});
  const callbackSignature=createHmac('sha256',env.DOCUSIGN_CONNECT_HMAC_SECRET).update(callbackBody).digest('base64');
  async function callback(body=callbackBody,signature=callbackSignature) {
    return concierge.fetch(new Request(`https://concierge.test/docusign/connect?contactId=${contactId}`,{method:'POST',headers:{'content-type':'application/json','x-docusign-signature-1':signature},body}),env,{});
  }
  assert.equal((await callback(callbackBody,'')).status,401);
  assert.equal((await callback(callbackBody+' ')).status,401);
  const wrongBody=JSON.stringify({envelopeId:'other-envelope',status:'completed'});
  assert.equal((await callback(wrongBody,createHmac('sha256',env.DOCUSIGN_CONNECT_HMAC_SECRET).update(wrongBody).digest('base64'))).status,403);
  assert.equal((await post('video/action',{...auth,action:'contact-status'})).documentStatus,'Sent');
  await concierge.fetch(new Request(`https://concierge.test/docusign/connect?contactId=${contactId}`,{method:'POST',headers:{'content-type':'application/json','x-docusign-signature-1':createHmac('sha256',env.DOCUSIGN_CONNECT_HMAC_SECRET).update(JSON.stringify({envelopeId:'envelope-test',status:'completed'})).digest('base64')},body:JSON.stringify({envelopeId:'envelope-test',status:'completed'})}),env,{});
  assert.equal((await post('video/action',{...auth,action:'contact-status'})).documentStatus,'Signed');
  assert.equal((await post('video/session',{customerToken,contactId})).workflow.phase,'awaiting-delivery');
  const options=await post('video/action',{...auth,action:'delivery-options'}); assert.equal(options.options.length,3);
  assert.equal((await post('video/action',{...auth,action:'delivery-schedule',optionIndex:99})).ok,false);
  const scheduled=await post('video/action',{...auth,action:'delivery-schedule',optionIndex:0});
  assert.equal(scheduled.ok,true,scheduled.error); assert.equal(calendarCalls,1);
  assert.equal(db.readDb().contacts.find(c=>c.id===contactId).stage,'Scheduled');
  const notified=sent.length;
  assert.equal((await (await callback()).json()).duplicate,true);
  assert.equal(sent.length,notified);
  assert.equal(db.readDb().contacts.find(c=>c.id===contactId).stage,'Scheduled');
  const transcript={...auth,room:session.room,ended:true,messages:[{role:'customer',text:'Option one please',segmentId:'segment-one',at:Date.now()}]};
  const before=JSON.stringify(db.readDb());
  for (const changed of [{workflowToken:''},{workflowToken:'forged'},{sessionId:'other'},{contactId:'other'}]) assert.equal((await post('video/transcript',{...transcript,...changed})).ok,false);
  assert.equal(JSON.stringify(db.readDb()),before);
  assert.equal((await post('video/transcript',transcript)).savedMessages,1);
  assert.equal((await post('video/transcript',transcript)).savedMessages,0);
  const resumed=await post('video/session',{customerToken,contactId});
  assert.equal(resumed.workflow.phase,'complete'); assert.equal(resumed.history.messages[0].text,'Option one please');
  assert.equal(db.readDb().contacts.find(c=>c.id===contactId).stage,'Scheduled');
  const prior=mediaCalls;
  assert.equal((await post('video/session',{customerToken,contactId:'missing'})).ok,false); assert.equal(mediaCalls,prior);
  const secret=env.INTERNAL_CALL_SECRET; env.INTERNAL_CALL_SECRET='';
  assert.equal((await post('video/session',{customerToken,contactId})).ok,false); assert.equal(mediaCalls,prior); env.INTERNAL_CALL_SECRET=secret;
  failMedia=true; assert.equal((await post('video/session',{customerToken,contactId})).ok,false); failMedia=false;
  malformedMedia=true; assert.equal((await post('video/session',{customerToken,contactId})).ok,false); malformedMedia=false;
  const denied=await concierge.fetch(new Request('https://concierge.test/internal/video/context',{method:'POST',body:'{}'}),env,{}); assert.equal(denied.status,401);
  assert.match(readFileSync(new URL('../apps/dashboard/wrangler.toml',import.meta.url),'utf8'),/binding = "ASSISTANT"\s+service = "buddys-assistant-adapter"/);
  console.log('PASS: Pages → dashboard → sealed adapter; product → document → signature → delivery → CRM → authenticated transcript → resume; failure and isolation checks');
} finally { globalThis.fetch=originalFetch; sqlite.close(); }
