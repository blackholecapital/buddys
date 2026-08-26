const baseUrl = String(process.env.BUDDY_RUNTIME_URL || "https://alley-voice.xyz-labs.xyz").replace(/\/$/, "");
const token = String(process.env.BUDDY_RUNTIME_TOKEN || "").trim();
const voiceId = String(process.env.BUDDY_VIDEO_VOICE_ID || "buddy").trim();

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers:{
      accept:"application/json",
      ...(token ? { "x-runtime-token":token } : {}),
      ...(init.headers || {}),
    },
    signal:AbortSignal.timeout(20_000),
  });
}

const healthResponse = await request("/health");
const health = await healthResponse.json().catch(() => ({}));
const errors = [];
const available = Array.isArray(health?.tts?.availableVoices) ? health.tts.availableVoices : [];
const prepared = Array.isArray(health?.tts?.preparedVoices) ? health.tts.preparedVoices : [];

if (!healthResponse.ok || health?.ok !== true) errors.push(`health failed (${healthResponse.status})`);
if (health?.compatibility?.chat !== true || health?.llm?.baseUrlConfigured !== true || !health?.llm?.model) errors.push("LLM chat is not configured");
if (health?.tts?.loaded !== true) errors.push("TTS backend is not loaded");
if (!available.includes(voiceId)) errors.push(`voice '${voiceId}' is not available`);
if (!prepared.includes(voiceId)) errors.push(`voice '${voiceId}' is not prepared`);

if (errors.length) {
  console.error(`FAIL Buddy runtime readiness: ${errors.join("; ")}`);
  process.exit(1);
}

console.log(`PASS Buddy runtime health (${health.llm.provider}:${health.llm.model}, ${health.tts.backend}:${voiceId})`);

if (!token) {
  console.log("SKIP authenticated chat/TTS probes (set BUDDY_RUNTIME_TOKEN)");
  process.exit(0);
}

const chatResponse = await request("/chat", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({ text:"Reply with exactly: Buddy runtime ready" }),
});
const chatText = await chatResponse.text();
if (!chatResponse.ok || !chatText.trim()) throw new Error(`Buddy chat probe failed (${chatResponse.status})`);
console.log(`PASS Buddy LLM chat (${chatResponse.status})`);

const ttsResponse = await request("/tts/livekit", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({ text:"Buddy voice is ready.", sessionId:"buddy-readiness", voiceId }),
});
const audio = await ttsResponse.arrayBuffer();
if (!ttsResponse.ok || audio.byteLength < 1000) throw new Error(`Buddy TTS probe failed (${ttsResponse.status}, ${audio.byteLength} bytes)`);
console.log(`PASS Buddy LiveKit TTS (${audio.byteLength} bytes)`);
