import assert from "node:assert/strict";
import worker from "../apps/blackhole-concierge-worker/src/index.js";

let forwarded;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (request) => {
  const url = String(request instanceof Request ? request.url : request);
  if (url === "https://alley-voice.xyz-labs.xyz/health") {
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
  BLACKHOLE_CAPABILITY_TOKEN:"test-capability-token",
  BUDDY_LIVE_SOURCE:"image-url",
  BUDDY_AVATAR_IMAGE_URL:"https://buddys.pages.dev/buddys/images/buddy-avatar.jpg",
  BUDDY_LEMONSLICE_AGENT_ID:"agent_should_not_be_forwarded",
  BUDDY_VIDEO_VOICE_PROVIDER:"eila-runtime",
  BUDDY_VIDEO_VOICE_ID:"buddy",
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

globalThis.fetch = originalFetch;

assert.equal(response.status, 200);
assert.equal(forwarded.product, "buddys-personal-shopper");
assert.equal(forwarded.avatarProvider, "lemonslice");
assert.equal(forwarded.avatarSource, "image-url");
assert.equal(forwarded.avatarImageUrl, "https://buddys.pages.dev/buddys/images/buddy-avatar.jpg");
assert.equal(forwarded.lemonsliceAgentId, "");
assert.equal(forwarded.voiceProvider, "eila-runtime");
assert.equal(forwarded.voiceId, "buddy");
assert.match(forwarded.instructions, /Interest: TVs/);
assert.match(forwarded.instructions, /Area: Orlando/);

const body = await response.json();
assert.equal(body.runtime.voiceId, "buddy");
assert.equal(body.runtime.llm.model, "qwen3.5:9b");

let videoCalledWithoutVoice = false;
globalThis.fetch = async (request) => {
  const url = String(request instanceof Request ? request.url : request);
  if (url === "https://alley-voice.xyz-labs.xyz/health") {
    return Response.json({
      ok:true,
      compatibility:{ chat:true },
      llm:{ provider:"ollama", model:"qwen3.5:9b", baseUrlConfigured:true },
      tts:{ backend:"chatterbox", loaded:true, availableVoices:["ebc"], preparedVoices:["ebc"] },
    });
  }
  return originalFetch(request);
};

const rejected = await worker.fetch(new Request("https://buddys.internal/internal/video/session", {
  method:"POST",
  headers:{ "content-type":"application/json", "x-internal-call-secret":"test-internal-secret" },
  body:JSON.stringify({ source:"direct" }),
}), {
  ...env,
  VIDEO:{ async fetch() { videoCalledWithoutVoice = true; return Response.json({ ok:true }); } },
}, { waitUntil() {} });

globalThis.fetch = originalFetch;
const rejectedBody = await rejected.json();
assert.equal(rejected.status, 502);
assert.match(rejectedBody.error, /voice 'buddy' is not available/);
assert.equal(videoCalledWithoutVoice, false);

console.log("Buddy image-avatar video payload: OK");
console.log("Buddy missing-voice preflight: OK");
