import assert from 'node:assert/strict';
import {resolveSecrets, withSecrets} from '../apps/shared/worker-secrets.mjs';
import sms from '../apps/sms-worker/src/index.js';
import email from '../apps/email-worker/src/index.js';
import voice from '../apps/voice-worker/src/index.js';
import concierge from '../apps/blackhole-concierge-worker/src/index.js';

const secret = value => ({async get() { return value; }});
const env = Object.freeze({KEY:secret('key-one'), DB:{get(){throw Error('not a secret');}}});
const resolved = await resolveSecrets(env, ['KEY']);
assert.equal(resolved.KEY,'key-one'); assert.equal(resolved.DB,env.DB);
assert.equal(typeof env.KEY.get,'function');
const values = await Promise.all(['a','b'].map(value => resolveSecrets({KEY:secret(value)},['KEY'])));
assert.deepEqual(values.map(value=>value.KEY),['a','b']);
assert.equal((await resolveSecrets({KEY:'plain'},['KEY'])).KEY,'plain');
assert.equal((await resolveSecrets({},['KEY'])).KEY,undefined);
let invoked = false;
for(const bad of [{}, secret(null), secret(''), secret(42), {get(){throw Error('SECRET_VALUE_MUST_NOT_LEAK');}}]) {
  const response = await withSecrets(()=>{invoked=true;},['KEY'])(new Request('https://test'),{KEY:bad});
  assert.equal(response.status,503); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{ok:false,error:'secret_binding_unavailable'});
}
assert.equal(invoked,false);
// Real channel entrypoints must resolve credentials before forming provider headers.
const original = globalThis.fetch;
let calls=0;
globalThis.fetch = async (url, options) => {
  calls++;
  if(String(url).startsWith('https://api.twilio.com/')) {
    assert.equal(options.headers.Authorization,'Basic '+btoa('ACtest:twilio-token'));
    return Response.json({sid:'SMtest'});
  }
  assert.equal(url,'https://api.resend.com/emails');
  assert.equal(options.headers.Authorization,'Bearer resend-key');
  return Response.json({id:'email-test'});
};
try {
  const request = () => new Request('https://test/internal/send',{method:'POST',headers:{'x-internal-call-secret':'internal'},body:JSON.stringify({contact:{phone:'+15555550123',email:'test@example.test'},message:'Test'})});
  const common = {INTERNAL_CALL_SECRET:secret('internal')};
  assert.equal((await sms.fetch(request(),{...common,TWILIO_ACCOUNT_SID:secret('ACtest'),TWILIO_AUTH_TOKEN:secret('twilio-token'),TWILIO_PHONE_NUMBER:'+15555550124'})).status,200);
  assert.equal((await email.fetch(request(),{...common,RESEND_API_KEY:secret('resend-key'),FROM_EMAIL:'buddy@example.test'})).status,200);
  assert.equal(calls,2);
  for(const worker of [sms,email,voice,concierge]) {
    const response=await worker.fetch(new Request('https://test/internal/send',{method:'POST',body:'{}'}),{INTERNAL_CALL_SECRET:{get(){throw Error('secret value');}}});
    assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/secret value/);
  }
  assert.equal(calls,2,'Store failures must not call providers');
  const response=await voice.fetch(new Request('https://test/internal/calls',{method:'POST',body:'{}'}),{INTERNAL_CALL_SECRET:secret('internal')});
  assert.equal(response.status,401);
} finally {globalThis.fetch=original;}
console.log('PASS: async/ordinary secrets, request isolation, redacted failures, real SMS/email credentials and voice authentication');
