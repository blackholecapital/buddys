import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import worker from '../apps/dashboard/worker-entry.mjs';
import smsWorker from '../apps/sms-worker/src/index.js';
import emailWorker from '../apps/email-worker/src/index.js';
import adapter from '../blackhole-runtime/src/index.js';
import concierge from '../apps/blackhole-concierge-worker/src/index.js';
const require=createRequire(import.meta.url);
const { issue, verify }=require('../apps/dashboard/shared/services/video-session-auth');
const cors=require('../apps/dashboard/shared/services/cors');
const envModule=require('../apps/dashboard/shared/env');
const providers=require('../apps/dashboard/backend/layers/providers');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key'};
const env={NODE_ENV:'production',CF_ACCESS_TEAM_DOMAIN:'https://buddy-test.cloudflareaccess.com',CF_ACCESS_AUD:'buddy-dashboard',OPERATOR_ROLES_JSON:JSON.stringify({'admin@example.test':'admin','viewer@example.test':'viewer'}),INTERNAL_CALL_SECRET:'test-internal',ALLOWED_ORIGINS:'https://pages.test'};
const now=Math.floor(Date.now()/1000);
function token(overrides={},head={}) {
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=`${enc({alg:'RS256',kid:jwk.kid,...head})}.${enc({iss:env.CF_ACCESS_TEAM_DOMAIN,aud:[env.CF_ACCESS_AUD],sub:'operator-1',email:'admin@example.test',iat:now,exp:now+300,...overrides})}`;
  return `${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url')}`;
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
  assert.equal(String(input),`${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  return Response.json({keys:[jwk]});
};
async function request(path,headers={},method='GET') {
  return worker.fetch(new Request(`https://dashboard.test${path}`,{method,headers}),env,{});
}
let checks=0;
async function expectStatus(path,headers,status,method='GET') {assert.equal((await request(path,headers,method)).status,status);checks++;}
try {
  await expectStatus('/api/contacts',{},403);
  await expectStatus('/api/contacts',{'x-user-role':'admin','cf-access-authenticated-user-email':'admin@example.test'},403);
  const valid=token();
  await expectStatus('/api/contacts',{'cf-access-jwt-assertion':valid},200);
  for(const bad of [token({exp:now-1}),token({aud:['other-app']}),token({iss:'https://other.cloudflareaccess.com'}),token({nbf:now+300}),token({email:'unmapped@example.test'}),token({}, {alg:'HS256'}),valid.slice(0,-12)+'XXXXXXXXXXXX']) {
    await expectStatus('/api/contacts',{'cf-access-jwt-assertion':bad},403);
  }
  await expectStatus('/api/contacts',{'cf-access-jwt-assertion':token({email:'viewer@example.test'}),'x-user-role':'admin'},403,'POST');
  await expectStatus('/api/contacts/contact-with-hyphens',{},403,'PUT');
  await expectStatus('/api/contacts/contact-with-hyphens/extra',{},403,'PUT');
  await expectStatus('/api/contacts',{'x-internal-call-secret':env.INTERNAL_CALL_SECRET},200);
  await expectStatus('/api/settings',{'x-internal-call-secret':env.INTERNAL_CALL_SECRET},403);
  await expectStatus('/api/contacts',{'x-internal-call-secret':env.INTERNAL_CALL_SECRET},403,'POST');
  await expectStatus('/api/contacts',{'cf-access-jwt-assertion':valid,origin:'https://evil.test'},403);
  await expectStatus('/api/health',{origin:'https://evil.test'},403,'OPTIONS');
  const allowed=await request('/api/health',{origin:'https://pages.test'});
  assert.equal(allowed.headers.get('access-control-allow-origin'),'https://pages.test');checks++;
  assert.equal((await request('/api/health')).headers.get('access-control-allow-origin'),null);checks++;
  assert.equal(cors.allowedOrigin('null','https://dashboard.test',env),false);checks++;
  const contacts=require('../apps/dashboard/backend/layers/domain/contacts');
  const caller=contacts.create({firstName:'Test',phone:'+15555550000'});
  let calls=0;
  env.CONCIERGE={async fetch(){calls++;return Response.json({ok:true});}};
  const callToken=await issue(env.INTERNAL_CALL_SECRET,caller,'call','',now);
  const callPath=`/api/call-now?id=${caller.id}&sig=${callToken}`;
  await expectStatus(callPath,{},200);await expectStatus(callPath,{},400);assert.equal(calls,1);checks++;
  const staleCall=await issue(env.INTERNAL_CALL_SECRET,caller,'call','',now-7201);
  await expectStatus(`/api/call-now?id=${caller.id}&sig=${staleCall}`,{},400);
  const contact={id:'customer-1'};
  const capability=await issue('test-secret',contact,'customer','',now);
  assert.equal(await verify('test-secret',capability,contact,'customer','',now),true);checks++;
  for(const [c,p,s,t] of [[{id:'other'},'customer','',now],[{...contact,publicSessionVersion:1},'customer','',now],[contact,'workflow','',now],[contact,'customer','',now+86400]]) {
    assert.equal(await verify('test-secret',capability,c,p,s,t),false);checks++;
  }
  const workflow=await issue('test-secret',contact,'workflow','room-1',now);
  assert.equal(await verify('test-secret',workflow,contact,'workflow','room-1',now+7200),false);checks++;
  assert.equal(await verify('test-secret',workflow,contact,'workflow','room-2',now),false);checks++;
  assert.equal((await adapter.fetch(new Request('https://adapter.test/settings/api/assistant-settings',{method:'POST'}),{SETTINGS_AUTH_MODE:'access'})).status,403);checks++;
  assert.equal((await concierge.fetch(new Request('https://concierge.test/docusign/document/customer-1'),{},{})).status,401);checks++;
  for(const provider of [smsWorker,emailWorker]){
    assert.equal((await provider.fetch(new Request('https://provider.test/internal/send',{method:'POST',body:'{}'}),{INTERNAL_CALL_SECRET:'configured'})).status,401);checks++;
  }
  envModule.setBindings({NODE_ENV:'production'});
  for(const settings of [{},{providers:{sms:'mock'}},{providers:{sms:'unknown'}}]) {assert.throws(()=>providers.getProvider('sms',settings),/Configure a real/);checks++;}
  assert.throws(()=>providers.getProvider('email',{providers:{email:'mock'}}),/Configure a real/);checks++;
  console.log(`PASS: ${checks} production security checks (real Worker entrypoint, Access signatures/claims/roles, internal scope, CORS, expiry/revocation, settings/documents and provider configuration)`);
} finally {globalThis.fetch=originalFetch;}
