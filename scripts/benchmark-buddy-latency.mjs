const baseUrl = String(process.env.BUDDY_RUNTIME_URL || "https://buddy-voice.xyz-labs.xyz").replace(/\/$/, "");
const token = String(process.env.BUDDY_RUNTIME_TOKEN || "").trim();
const voiceId = String(process.env.BUDDY_VIDEO_VOICE_ID || "buddy").trim();

if (!token) {
  console.error("Set BUDDY_RUNTIME_TOKEN to run authenticated latency probes.");
  process.exit(1);
}

const now = () => performance.now();
const ms = (value) => Math.round(value);

async function request(path, init = {}) {
  const started = now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers:{
      accept:"application/json",
      "x-runtime-token":token,
      ...(init.headers || {}),
    },
    signal:AbortSignal.timeout(120_000),
  });
  return { response, started, headersAt:now() };
}

const healthRequest = await request("/health");
const health = await healthRequest.response.json();
console.log(`health: ${healthRequest.response.status}, ${ms(now() - healthRequest.started)} ms, tts device=${health?.tts?.device || "unknown"}`);

const chatRequest = await request("/chat", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({ text:"Reply in one short sentence: Which smartphone should I consider?" }),
});
const chat = await chatRequest.response.json().catch(() => ({}));
const chatDone = now();
if (!chatRequest.response.ok) throw new Error(`chat failed (${chatRequest.response.status})`);
console.log(`chat: headers ${ms(chatRequest.headersAt - chatRequest.started)} ms, complete ${ms(chatDone - chatRequest.started)} ms`);

const speech = String(chat?.response || "I have two good smartphone options for you.").slice(0, 500);
const payload = JSON.stringify({ text:speech, sessionId:`buddy-latency-${Date.now()}`, voiceId });

const legacy = await request("/tts/livekit", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:payload,
});
const legacyAudio = await legacy.response.arrayBuffer();
const legacyDone = now();
if (!legacy.response.ok) throw new Error(`legacy TTS failed (${legacy.response.status})`);
console.log(`legacy TTS: first byte ${ms(legacy.headersAt - legacy.started)} ms, complete ${ms(legacyDone - legacy.started)} ms, ${legacyAudio.byteLength} bytes`);

const streaming = await request("/tts/livekit/stream", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:payload,
});
if (!streaming.response.ok) throw new Error(`streaming TTS failed (${streaming.response.status})`);
const reader = streaming.response.body.getReader();
let firstAudioAt = null;
let totalBytes = 0;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (value?.byteLength) {
    if (firstAudioAt === null) firstAudioAt = now();
    totalBytes += value.byteLength;
  }
}
const streamingDone = now();
console.log(`streaming TTS: first audio ${ms((firstAudioAt || streamingDone) - streaming.started)} ms, complete ${ms(streamingDone - streaming.started)} ms, ${totalBytes} bytes`);

console.log("Targets: first audio <800 ms p50 and <1200 ms p95. CPU Chatterbox or the public tunnel will miss them.");
