import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../apps/blackhole-concierge-worker/src/index.js";

const conciergeConfig = readFileSync(new URL("../apps/blackhole-concierge-worker/wrangler.toml", import.meta.url), "utf8");
const videoConfig = readFileSync(new URL("../apps/video-worker/wrangler.toml", import.meta.url), "utf8");
const agentSource = readFileSync(new URL("../apps/livekit-avatar-agent/src/agent.py", import.meta.url), "utf8");
const agentTts = readFileSync(new URL("../apps/livekit-avatar-agent/src/buddy_tts.py", import.meta.url), "utf8");
const latencyScript = readFileSync(new URL("./configure-buddy-avatar-latency.sh", import.meta.url), "utf8");

assert.match(conciergeConfig, /TENANT_ID = "buddys"/);
assert.match(conciergeConfig, /RUNTIME_TARGET = "blackhole"/);
assert.match(conciergeConfig, /binding = "VIDEO"\s+service = "blackhole-video-worker"/);
assert.match(videoConfig, /name = "buddys-video-worker"/);
assert.match(videoConfig, /VIDEO_AGENT_NAME = "buddys-avatar"/);
assert.match(videoConfig, /binding = "LIVEKIT_API_KEY"\s+store_id = "00b34d29f2c94685b0f250dc5b1ee875"\s+secret_name = "XYZ_DEMO_LIVEKIT_API_KEY"/);
assert.match(videoConfig, /binding = "LEMONSLICE_BUDDYS_API_KEY"\s+store_id = "00b34d29f2c94685b0f250dc5b1ee875"\s+secret_name = "XYZ_DEMO_LEMONSLICE_API_KEY"/);
assert.match(videoConfig, /binding = "BLACKHOLE_BUDDYS_CAPABILITY_TOKEN"\s+store_id = "00b34d29f2c94685b0f250dc5b1ee875"\s+secret_name = "BUDDYS_VIDEO_CAPABILITY_TOKEN"/);
assert.doesNotMatch(conciergeConfig, /secret_name = "XYZ_DEMO_EILA_RUNTIME_TOKEN"/);
assert.match(conciergeConfig, /standard encrypted Worker secret named BLACKHOLE_CAPABILITY_TOKEN/);
// Buddy's dedicated worker and agent remain standalone rollback assets.
assert.match(agentSource, /TENANT_ID = "buddys"/);
assert.match(agentSource, /AGENT_NAME = os\.getenv\("AGENT_NAME", "buddys-avatar"\)/);
assert.match(conciergeConfig, /BUDDY_VIDEO_VOICE_PROVIDER = "livekit-inference"/);
assert.match(conciergeConfig, /BUDDY_VIDEO_VOICE_MODEL = "xai\/tts-1"/);
assert.match(conciergeConfig, /BUDDY_VIDEO_VOICE_ID = "leo"/);
assert.doesNotMatch(`${agentSource}\n${agentTts}\n${latencyScript}`, /cloudflare-platform|EILA_RUNTIME_URL|AI_FANS_RUNTIME_URL|:8200/);

let forwarded;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (request) => {
  const url = String(request instanceof Request ? request.url : request);
  if (url === "https://buddy-voice.xyz-labs.xyz/health") {
    return Response.json({
      ok:true,
      compatibility:{ chat:true },
      llm:{ provider:"ollama", model:"qwen3.5:9b", baseUrlConfigured:true },
      tts:{ backend:"chatterbox", loaded:true, availableVoices:["buddy"], preparedVoices:["buddy"] },
    });
  }
  return originalFetch(request);
};
const env = {
  INTERNAL_CALL_SECRET:"test-internal-secret",
  TENANT_ID:"buddys",
  RUNTIME_TARGET:"blackhole",
  BLACKHOLE_CAPABILITY_TOKEN:{ async get() { return "test-capability-token"; } },
  BUDDY_LIVE_SOURCE:"image-url",
  BUDDY_AVATAR_IMAGE_URL:"https://buddys.pages.dev/buddys/images/buddy-avatar.jpg",
  BUDDY_LEMONSLICE_AGENT_ID:"agent_should_not_be_forwarded",
  BUDDY_VIDEO_VOICE_PROVIDER:"livekit-inference",
  BUDDY_VIDEO_VOICE_MODEL:"xai/tts-1",
  BUDDY_VIDEO_VOICE_ID:"leo",
  BUDDY_RUNTIME_URL:"https://buddy-voice.xyz-labs.xyz",
  VIDEO:{
    async fetch(request) {
      assert.equal(request.headers.get("x-blackhole-capability-token"), "test-capability-token");
      forwarded = await request.json();
      return Response.json({ ok:true, livekitUrl:"wss://example.livekit.cloud", token:"test-token" });
    },
  },
};

const response = await worker.fetch(new Request("https://buddys.internal/internal/video/session", {
  method:"POST",
  headers:{ "content-type":"application/json", "x-internal-call-secret":"test-internal-secret" },
  body:JSON.stringify({ source:"direct", context:{ interest:"TVs", location:"Orlando" } }),
}), env, { waitUntil() {} });
const initialForwarded = forwarded;

const resumeResponse = await worker.fetch(new Request("https://buddys.internal/internal/video/session", {
  method:"POST",
  headers:{ "content-type":"application/json", "x-internal-call-secret":"test-internal-secret" },
  body:JSON.stringify({
    source:"lead-resume",
    contact:{
      id:"contact-resume",
      firstName:"Sam",
      interest:"Smartphones",
      selectedProduct:"Apple iPhone 16 Pro",
      documentStatus:"Sent",
      docusignEnvelopeId:"envelope-1",
      signingShortUrl:"https://example.com/sign",
    },
  }),
}), env, { waitUntil() {} });

globalThis.fetch = originalFetch;

assert.equal(response.status, 200);
assert.equal(initialForwarded.tenantId, "buddys");
assert.equal(initialForwarded.product, "buddys-personal-shopper");
assert.equal(initialForwarded.avatarProvider, "lemonslice");
assert.equal(initialForwarded.avatarSource, "image-url");
assert.equal(initialForwarded.avatarImageUrl, "https://buddys.pages.dev/buddys/images/buddy-avatar.jpg");
assert.equal(initialForwarded.lemonsliceAgentId, "");
assert.equal(initialForwarded.voiceProvider, "livekit-inference");
assert.equal(initialForwarded.voiceModel, "xai/tts-1");
assert.equal(initialForwarded.voiceId, "leo");
assert.match(initialForwarded.instructions, /Interest: TVs/);
assert.match(initialForwarded.instructions, /Area: Orlando/);
assert.match(initialForwarded.instructions, /65-inch OLED 4K Smart TV/);
assert.match(initialForwarded.instructions, /75-inch QLED 4K Smart TV/);
assert.match(initialForwarded.instructions, /\[BUDDY WORKFLOW\]/);

const body = await response.json();
assert.equal(body.workflow.productOptions.length, 2);
assert.equal(body.workflow.productOptions[0].id, "tv-65-oled");
assert.equal(body.workflow.phase, "awaiting-product");
assert.equal(body.runtime.voiceId, "buddy");
assert.equal(body.runtime.llm.model, "qwen3.5:9b");

const resumeBody = await resumeResponse.json();
assert.equal(resumeResponse.status, 200);
assert.equal(resumeBody.workflow.phase, "awaiting-signature");
assert.equal(resumeBody.workflow.selectedProduct, "Apple iPhone 16 Pro");
assert.equal(resumeBody.workflow.signingUrl, "https://example.com/sign");
assert.match(resumeBody.workflow.resumePrompt, /already selected/i);

let videoCalledWithDegradedPublicRuntime = false;
globalThis.fetch = async (request) => {
  const url = String(request instanceof Request ? request.url : request);
  if (url === "https://buddy-voice.xyz-labs.xyz/health") {
    return Response.json({
      ok:true,
      compatibility:{ chat:true },
      llm:{ provider:"ollama", model:"qwen3.5:9b", baseUrlConfigured:true },
      tts:{ backend:"chatterbox", loaded:true, availableVoices:["ebc"], preparedVoices:["ebc"] },
    });
  }
  return originalFetch(request);
};

const degradedRuntimeResponse = await worker.fetch(new Request("https://buddys.internal/internal/video/session", {
  method:"POST",
  headers:{ "content-type":"application/json", "x-internal-call-secret":"test-internal-secret" },
  body:JSON.stringify({ source:"direct" }),
}), {
  ...env,
  VIDEO:{ async fetch() { videoCalledWithDegradedPublicRuntime = true; return Response.json({ ok:true }); } },
}, { waitUntil() {} });

globalThis.fetch = originalFetch;
const degradedRuntimeBody = await degradedRuntimeResponse.json();
assert.equal(degradedRuntimeResponse.status, 200);
assert.equal(degradedRuntimeBody.runtime.ok, false);
assert.equal(degradedRuntimeBody.runtime.requiredForSession, false);
assert.match(degradedRuntimeBody.runtime.errors.join(" "), /voice 'buddy' is not available/);
assert.equal(videoCalledWithDegradedPublicRuntime, true);

let videoLeadSms = null;
const videoLeadResponse = await worker.fetch(new Request("https://buddys.internal/internal/leads", {
  method:"POST",
  headers:{ "content-type":"application/json", "x-internal-call-secret":"test-internal-secret" },
  body:JSON.stringify({
    contact:{ firstName:"Sam", phone:"+15550000001", smsConsent:true },
    lead:{ contact_method:"Video", consent:true, product_interest:"living room" },
  }),
}), {
  INTERNAL_CALL_SECRET:"test-internal-secret",
  SMS:{
    async fetch(request) {
      videoLeadSms = await request.json();
      return Response.json({ ok:true, providerMessageId:"sms-video-lead" });
    },
  },
}, { waitUntil() {} });

const videoLeadBody = await videoLeadResponse.json();
assert.equal(videoLeadResponse.status, 200);
assert.equal(videoLeadBody.contactFlow, "video-room-plus-sms");
assert.equal(videoLeadBody.results.sms.ok, true);
assert.equal(videoLeadSms.messageType, "buddy-video-welcome");
assert.match(videoLeadSms.message, /reply CALL/i);

console.log("Buddy image-avatar video payload and live sales options: OK");
console.log("Buddy public runtime health is advisory for shared-runtime sessions: OK");
console.log("Buddy video lead SMS follow-up: OK");
console.log("Buddy standalone tenant adapter and rollback boundary: OK");
