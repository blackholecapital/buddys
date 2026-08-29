import { readFileSync } from "node:fs";

function readEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
  } catch {
    return {};
  }
}

const localEnv = readEnv(new URL("../apps/livekit-avatar-agent/.env", import.meta.url));
const config = { ...localEnv, ...process.env };
const baseUrl = String(
  config.BUDDY_RUNTIME_URL ||
  config.BLACKHOLE_BUDDYS_RUNTIME_URL ||
  "http://127.0.0.1:8010"
).replace(/\/$/, "");
const token = String(
  config.BUDDY_RUNTIME_TOKEN ||
  config.BLACKHOLE_BUDDYS_RUNTIME_TOKEN ||
  ""
).trim();
const voiceId = String(config.BUDDY_VIDEO_VOICE_ID || "buddy").trim();
const sampleRate = 24_000;
const bytesPerSample = 2;
const probeText = String(
  config.BUDDY_BENCH_TEXT ||
  "I can help you compare smartphones, review the best options for your budget, send the agreement by text, and schedule delivery when you are ready."
).trim();

if (!token) {
  console.error("Buddy runtime token was not found in the environment or avatar-agent .env.");
  process.exit(1);
}

const now = () => performance.now();
const ms = (value) => Math.round(value);

async function request(path, init = {}) {
  const started = now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "x-runtime-token": token,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  return { response, started, headersAt: now() };
}

function payload(text) {
  return JSON.stringify({
    text,
    sessionId: `buddy-latency-${Date.now()}`,
    voiceId,
  });
}

async function main() {
const healthRequest = await request("/health");
const health = await healthRequest.response.json();
console.log(
  `health: ${healthRequest.response.status}, ${ms(now() - healthRequest.started)} ms, ` +
  `tts device=${health?.tts?.device || "unknown"}, voice=${voiceId}`
);

const chatRequest = await request("/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "Reply in one short sentence: Which smartphone should I consider?" }),
});
const chat = await chatRequest.response.json().catch(() => ({}));
const chatDone = now();
if (!chatRequest.response.ok) throw new Error(`chat failed (${chatRequest.response.status})`);
console.log(
  `chat: headers ${ms(chatRequest.headersAt - chatRequest.started)} ms, ` +
  `complete ${ms(chatDone - chatRequest.started)} ms, characters=${String(chat?.response || "").length}`
);

const legacy = await request("/tts/livekit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: payload(probeText),
});
const legacyAudio = await legacy.response.arrayBuffer();
const legacyDone = now();
if (!legacy.response.ok) throw new Error(`legacy TTS failed (${legacy.response.status})`);
const legacyAudioMs = legacyAudio.byteLength / (sampleRate * bytesPerSample) * 1000;
console.log(
  `legacy TTS: first byte ${ms(legacy.headersAt - legacy.started)} ms, ` +
  `complete ${ms(legacyDone - legacy.started)} ms, audio ${ms(legacyAudioMs)} ms, ` +
  `${legacyAudio.byteLength} bytes`
);

const streaming = await request("/tts/livekit/stream", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: payload(probeText),
});
if (!streaming.response.ok) throw new Error(`streaming TTS failed (${streaming.response.status})`);

const reader = streaming.response.body.getReader();
let firstAudioAt = null;
let bufferedUntil = null;
let totalBytes = 0;
let reads = 0;
let totalUnderrunMs = 0;
let maxUnderrunMs = 0;
const underruns = [];

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (!value?.byteLength) continue;

  const arrivedAt = now();
  if (firstAudioAt === null) {
    firstAudioAt = arrivedAt;
    bufferedUntil = arrivedAt;
  } else if (bufferedUntil !== null && arrivedAt > bufferedUntil) {
    const gap = arrivedAt - bufferedUntil;
    totalUnderrunMs += gap;
    maxUnderrunMs = Math.max(maxUnderrunMs, gap);
    underruns.push(ms(gap));
  }

  const audioMs = value.byteLength / (sampleRate * bytesPerSample) * 1000;
  bufferedUntil = Math.max(bufferedUntil ?? arrivedAt, arrivedAt) + audioMs;
  totalBytes += value.byteLength;
  reads += 1;
}

const streamingDone = now();
const streamingAudioMs = totalBytes / (sampleRate * bytesPerSample) * 1000;
console.log(
  `streaming TTS: first audio ${ms((firstAudioAt || streamingDone) - streaming.started)} ms, ` +
  `response complete ${ms(streamingDone - streaming.started)} ms, audio ${ms(streamingAudioMs)} ms, ` +
  `reads=${reads}, bytes=${totalBytes}`
);
console.log(
  `playout health: underruns=${underruns.length}, total underrun=${ms(totalUnderrunMs)} ms, ` +
  `max underrun=${ms(maxUnderrunMs)} ms, gaps=[${underruns.join(",")}]`
);
console.log(
  "Targets: first audio <1200 ms p95; total/max underrun 0 ms. " +
  "Any underrun predicts an audible stall or stutter."
);

}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
