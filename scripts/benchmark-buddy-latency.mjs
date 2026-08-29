import { readFileSync } from "fs";
import http from "http";
import https from "https";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";

function readEnv(path) {
  var result = {};
  try {
    readFileSync(path, "utf8").split(/\r?\n/).forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line || line.charAt(0) === "#" || line.indexOf("=") < 0) return;
      var index = line.indexOf("=");
      result[line.slice(0, index)] = line.slice(index + 1);
    });
  } catch (error) {
    return {};
  }
  return result;
}

var envPath = fileURLToPath(new URL("../apps/livekit-avatar-agent/.env", import.meta.url));
var localEnv = readEnv(envPath);
var config = Object.assign({}, localEnv, process.env);
var baseUrl = String(
  config.BUDDY_RUNTIME_URL ||
  config.BLACKHOLE_BUDDYS_RUNTIME_URL ||
  "http://127.0.0.1:8010"
).replace(/\/$/, "");
var token = String(
  config.BUDDY_RUNTIME_TOKEN ||
  config.BLACKHOLE_BUDDYS_RUNTIME_TOKEN ||
  ""
).trim();
var voiceId = String(config.BUDDY_VIDEO_VOICE_ID || "buddy").trim();
var sampleRate = 24000;
var bytesPerSample = 2;
var probeText = String(
  config.BUDDY_BENCH_TEXT ||
  "I can help you compare smartphones, review the best options for your budget, send the agreement by text, and schedule delivery when you are ready."
).trim();

if (!token) {
  console.error("Buddy runtime token was not found in the environment or avatar-agent .env.");
  process.exit(1);
}

function now() {
  return performance.now();
}

function ms(value) {
  return Math.round(value);
}

function openRequest(path, init) {
  init = init || {};
  var target = new URL(path, baseUrl + "/");
  var transport = target.protocol === "https:" ? https : http;
  var body = init.body || "";
  var headers = Object.assign(
    {
      accept: "application/json",
      "x-runtime-token": token,
    },
    init.headers || {}
  );
  if (body && !headers["content-length"]) {
    headers["content-length"] = Buffer.byteLength(body);
  }

  return new Promise(function (resolve, reject) {
    var started = now();
    var req = transport.request(
      target,
      {
        method: init.method || "GET",
        headers: headers,
      },
      function (response) {
        resolve({ response: response, started: started, headersAt: now() });
      }
    );
    req.setTimeout(120000, function () {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function collect(response, onChunk) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    response.on("data", function (chunk) {
      chunks.push(chunk);
      if (onChunk) onChunk(chunk);
    });
    response.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    response.on("error", reject);
  });
}

function assertOk(request, label) {
  var status = request.response.statusCode || 0;
  if (status < 200 || status >= 300) {
    throw new Error(label + " failed (" + status + ")");
  }
}

function speechPayload(text) {
  return JSON.stringify({
    text: text,
    sessionId: "buddy-latency-" + Date.now(),
    voiceId: voiceId,
  });
}

async function main() {
  var healthRequest = await openRequest("/health");
  var healthBody = await collect(healthRequest.response);
  assertOk(healthRequest, "health");
  var health = JSON.parse(healthBody.toString("utf8"));
  var ttsDevice = health && health.tts && health.tts.device
    ? health.tts.device
    : "unknown";
  console.log(
    "health: " + healthRequest.response.statusCode + ", " +
    ms(now() - healthRequest.started) + " ms, tts device=" +
    ttsDevice + ", voice=" + voiceId
  );

  var chatRequest = await openRequest("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "Reply in one short sentence: Which smartphone should I consider?",
    }),
  });
  var chatBody = await collect(chatRequest.response);
  var chatDone = now();
  assertOk(chatRequest, "chat");
  var chat = JSON.parse(chatBody.toString("utf8"));
  var chatText = String(chat && chat.response ? chat.response : "");
  console.log(
    "chat: headers " + ms(chatRequest.headersAt - chatRequest.started) +
    " ms, complete " + ms(chatDone - chatRequest.started) +
    " ms, characters=" + chatText.length
  );

  var legacy = await openRequest("/tts/livekit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: speechPayload(probeText),
  });
  var legacyAudio = await collect(legacy.response);
  var legacyDone = now();
  assertOk(legacy, "legacy TTS");
  var legacyAudioMs = legacyAudio.length / (sampleRate * bytesPerSample) * 1000;
  console.log(
    "legacy TTS: first byte " + ms(legacy.headersAt - legacy.started) +
    " ms, complete " + ms(legacyDone - legacy.started) +
    " ms, audio " + ms(legacyAudioMs) +
    " ms, " + legacyAudio.length + " bytes"
  );

  var streaming = await openRequest("/tts/livekit/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: speechPayload(probeText),
  });
  assertOk(streaming, "streaming TTS");

  var firstAudioAt = null;
  var bufferedUntil = null;
  var totalBytes = 0;
  var reads = 0;
  var totalUnderrunMs = 0;
  var maxUnderrunMs = 0;
  var underruns = [];

  await collect(streaming.response, function (value) {
    if (!value || !value.length) return;
    var arrivedAt = now();
    if (firstAudioAt === null) {
      firstAudioAt = arrivedAt;
      bufferedUntil = arrivedAt;
    } else if (bufferedUntil !== null && arrivedAt > bufferedUntil) {
      var gap = arrivedAt - bufferedUntil;
      totalUnderrunMs += gap;
      maxUnderrunMs = Math.max(maxUnderrunMs, gap);
      underruns.push(ms(gap));
    }

    var audioMs = value.length / (sampleRate * bytesPerSample) * 1000;
    bufferedUntil = Math.max(
      bufferedUntil === null ? arrivedAt : bufferedUntil,
      arrivedAt
    ) + audioMs;
    totalBytes += value.length;
    reads += 1;
  });

  var streamingDone = now();
  var streamingAudioMs = totalBytes / (sampleRate * bytesPerSample) * 1000;
  console.log(
    "streaming TTS: first audio " +
    ms((firstAudioAt === null ? streamingDone : firstAudioAt) - streaming.started) +
    " ms, response complete " + ms(streamingDone - streaming.started) +
    " ms, audio " + ms(streamingAudioMs) +
    " ms, reads=" + reads + ", bytes=" + totalBytes
  );
  console.log(
    "playout health: underruns=" + underruns.length +
    ", total underrun=" + ms(totalUnderrunMs) +
    " ms, max underrun=" + ms(maxUnderrunMs) +
    " ms, gaps=[" + underruns.join(",") + "]"
  );
  console.log(
    "Targets: first audio <1200 ms p95; total/max underrun 0 ms. " +
    "Any underrun predicts an audible stall or stutter."
  );
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
