const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_PCM_RATE = 24000;
const TWILIO_PCM_RATE = 8000;
const TELEPHONY_CUTOFF_HZ = 3200;
const FIR_TAPS = 63;

function parseRawPcm16(bytes) {
  if (!bytes?.byteLength || bytes.byteLength % 2 !== 0) {
    throw new Error(`OpenAI PCM payload is invalid (${bytes?.byteLength || 0} bytes)`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0, p = 0; i < samples.length; i += 1, p += 2) {
    samples[i] = view.getInt16(p, true) / 32768;
  }
  return samples;
}

function sinc(x) {
  if (Math.abs(x) < 1e-12) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function buildLowPassKernel(sourceRate, cutoffHz = TELEPHONY_CUTOFF_HZ, taps = FIR_TAPS) {
  const length = taps % 2 === 0 ? taps + 1 : taps;
  const center = (length - 1) / 2;
  const normalizedCutoff = Math.min(cutoffHz / sourceRate, 0.499);
  const kernel = new Float64Array(length);
  let sum = 0;

  for (let i = 0; i < length; i += 1) {
    const n = i - center;
    const ideal = 2 * normalizedCutoff * sinc(2 * normalizedCutoff * n);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
    const value = ideal * hamming;
    kernel[i] = value;
    sum += value;
  }

  if (Math.abs(sum) > 1e-12) {
    for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;
  }
  return kernel;
}

function lowPassAndDecimate(input, sourceRate, targetRate = TWILIO_PCM_RATE) {
  if (!input.length) return new Float32Array();
  if (sourceRate === targetRate) return input;

  const ratio = sourceRate / targetRate;
  if (!Number.isInteger(ratio)) throw new Error(`Unsupported PCM resample ratio ${sourceRate}:${targetRate}`);

  const kernel = buildLowPassKernel(sourceRate);
  const half = Math.floor(kernel.length / 2);
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let outIndex = 0; outIndex < outputLength; outIndex += 1) {
    const sourceIndex = outIndex * ratio;
    let acc = 0;
    for (let k = 0; k < kernel.length; k += 1) {
      const index = sourceIndex + k - half;
      if (index >= 0 && index < input.length) acc += input[index] * kernel[k];
    }
    output[outIndex] = acc;
  }
  return output;
}

function softLimit(sample, drive = 1.12) {
  const x = Math.max(-1.25, Math.min(1.25, sample));
  return Math.tanh(x * drive) / Math.tanh(drive);
}

function linearToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let pcm = Math.max(-1, Math.min(1, sample));
  pcm = Math.round(pcm * 32767);

  let sign = 0;
  if (pcm < 0) {
    sign = 0x80;
    pcm = -pcm;
  }

  pcm = Math.min(pcm, CLIP) + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && (pcm & mask) === 0; mask >>= 1) exponent -= 1;
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function pcmToTwilioMulaw(samples, sourceRate = OPENAI_PCM_RATE) {
  const mono8k = lowPassAndDecimate(samples, sourceRate, TWILIO_PCM_RATE);
  let peak = 0;
  for (let i = 0; i < mono8k.length; i += 1) peak = Math.max(peak, Math.abs(mono8k[i]));

  // Leave more headroom than the old path. Telephone mu-law exaggerates hot
  // sibilants and clipping, so keep the peak around -2 dBFS and avoid big boosts.
  const gain = peak > 0 ? Math.min(0.80 / peak, 1.08) : 1;
  const output = new Uint8Array(mono8k.length);
  for (let i = 0; i < mono8k.length; i += 1) {
    output[i] = linearToMulaw(softLimit(mono8k[i] * gain));
  }
  return output;
}

export async function openAiTwilioAudio(env, text) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = String(env.BUDDY_OPENAI_TTS_MODEL || "gpt-4o-mini-tts").trim();
  const voice = String(env.BUDDY_OPENAI_TTS_VOICE || "cedar").trim();
  const speed = Number(env.BUDDY_OPENAI_TTS_SPEED || 1);
  const instructions = String(
    env.BUDDY_OPENAI_TTS_INSTRUCTIONS ||
      "Speak as a polished, confident American male retail concierge. Warm, calm, and conversational. Use smooth consonants and softened sibilance, with no hiss or sharp S sounds. Avoid announcer cadence and exaggerated brightness. Use natural phrasing and subtle pauses."
  ).trim();

  const body = {
    model,
    voice,
    input: String(text || "").slice(0, 4096),
    response_format: "pcm",
    speed: Number.isFinite(speed) ? speed : 1,
  };
  if (instructions && !model.startsWith("tts-1")) body.instructions = instructions;

  const response = await fetch(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI TTS failed (${response.status}): ${errorBody.slice(0, 320)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const pcmBytes = new Uint8Array(await response.arrayBuffer());
  const samples = parseRawPcm16(pcmBytes);
  const audio = pcmToTwilioMulaw(samples, OPENAI_PCM_RATE);
  return {
    audio,
    provider: "openai",
    model,
    voice,
    contentType,
    sourceBytes: pcmBytes.byteLength,
    sourceRate: OPENAI_PCM_RATE,
    targetRate: TWILIO_PCM_RATE,
    lowPassHz: TELEPHONY_CUTOFF_HZ,
  };
}
