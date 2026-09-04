const PLANE_ID = "blackhole.shared-ai";
const RUNTIME_URL = "https://blackhole-runtime.xyz-labs.xyz";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_BYTES = 25 * 1024 * 1024;
const textEncoder = new TextEncoder();

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function corsHeaders(request, manifest) {
  const origin = request.headers.get("origin");
  const allowedOrigin = manifest.deployment?.app_origin;
  if (!origin || !allowedOrigin || origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function withCors(response, request, manifest) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request, manifest))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function cleanSlug(value, max = 63) {
  const clean = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(clean) ? clean.slice(0, max) : "";
}

async function bindingValue(binding, max = 2_000) {
  const value = binding && typeof binding.get === "function" ? await binding.get() : binding;
  return String(value ?? "").trim().slice(0, max);
}

async function bindingConfigured(binding) {
  try {
    return Boolean(await bindingValue(binding, 1));
  } catch {
    return false;
  }
}

function assistantById(manifest, value) {
  const assistantId = cleanSlug(value);
  return manifest.assistants.find((assistant) => assistant.assistant_id === assistantId) ?? null;
}

function objectKey(manifest, assistantId, name) {
  return `${manifest.tenant_id}/${assistantId}/${name}`;
}

async function readState(env, manifest, assistant) {
  const fallback = {
    assistantId: assistant.assistant_id,
    displayName: assistant.display_name,
    avatar: assistant.avatar,
    voice: assistant.voice,
    revision: null,
  };
  if (!env.ASSISTANT_ASSETS?.get) return fallback;
  const object = await env.ASSISTANT_ASSETS.get(objectKey(manifest, assistant.assistant_id, "settings.json"));
  if (!object) return fallback;
  try {
    return { ...fallback, ...JSON.parse(await object.text()) };
  } catch {
    return fallback;
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-20).flatMap((message) => {
    const role = ["user", "assistant"].includes(message?.role) ? message.role : "user";
    const content = String(message?.content ?? message?.text ?? "").trim().slice(0, 4_000);
    return content ? [{ role, content }] : [];
  });
}

function promptFor(assistant, instructions, messages) {
  const conversation = messages
    .map((message) => `${message.role === "assistant" ? assistant.display_name : "User"}: ${message.content}`)
    .join("\n");
  return `${instructions}\n\n${conversation}\n${assistant.display_name}:`.slice(0, 24_000);
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validImage(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  if (contentType === "image/png") {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  }
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

function inspectVoiceWav(buffer) {
  const view = new DataView(buffer);
  const label = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (view.byteLength < 44 || label(0, 4) !== "RIFF" || label(8, 4) !== "WAVE") {
    throw new Error("voiceReference must be a valid RIFF/WAVE file");
  }
  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= view.byteLength) {
    const chunk = label(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > view.byteLength) throw new Error("voiceReference contains a truncated WAV chunk");
    if (chunk === "fmt " && size >= 16) {
      format = {
        encoding: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        byteRate: view.getUint32(start + 8, true),
        bitsPerSample: view.getUint16(start + 14, true),
      };
    }
    if (chunk === "data") dataBytes = size;
    offset = start + size + (size % 2);
  }
  if (!format || dataBytes === null || !format.byteRate) throw new Error("voiceReference is missing WAV format or audio data");
  const durationSeconds = dataBytes / format.byteRate;
  if (format.encoding !== 1 || format.channels !== 1 || format.sampleRate !== 24_000 || format.bitsPerSample !== 16) {
    throw new Error("voiceReference must be mono PCM16 at 24 kHz");
  }
  if (durationSeconds < 10 || durationSeconds > 60) {
    throw new Error("voiceReference must be between 10 and 60 seconds");
  }
  return { durationSeconds, sampleRate: format.sampleRate, channels: format.channels };
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

async function authorizeCloudflareAccess(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion") ?? "";
  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN ?? "").replace(/\/$/, "");
  const audience = String(env.CF_ACCESS_AUD ?? "").trim();
  if (!token || !teamDomain || !audience || !teamDomain.startsWith("https://")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (header.alg !== "RS256" || !header.kid) return null;
    const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const keySet = await response.json();
    const jwk = [...(keySet.keys ?? []), ...(keySet.public_certs ?? [])].find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      textEncoder.encode(`${parts[0]}.${parts[1]}`),
    );
    const now = Math.floor(Date.now() / 1_000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const issuer = String(claims.iss ?? "").replace(/\/$/, "");
    if (!Number.isFinite(claims.exp) || (claims.nbf !== undefined && !Number.isFinite(claims.nbf))) return null;
    if (!valid || issuer !== teamDomain || !audiences.includes(audience) || claims.exp <= now || (claims.nbf && claims.nbf > now)) return null;
    return { email: String(claims.email ?? ""), subject: String(claims.sub ?? "") };
  } catch {
    return null;
  }
}

export function createTenantAdapter({
  manifest,
  instructionsFor = (assistant) => `You are ${assistant.display_name}. Be concise, capable, and conversational.`,
  authorizeSettings = authorizeCloudflareAccess,
  fetchImpl = fetch,
} = {}) {
  if (!manifest?.tenant_id || !Array.isArray(manifest.assistants) || manifest.assistants.length === 0) {
    throw new TypeError("a valid tenant manifest is required");
  }

  async function chat(request, env) {
    const body = await request.json().catch(() => ({}));
    if (body.tenantId !== manifest.tenant_id) return json({ ok: false, code: "tenant_mismatch" }, 403);
    const assistant = assistantById(manifest, body.assistantId);
    if (!assistant) return json({ ok: false, code: "unknown_assistant" }, 404);
    const messages = normalizeMessages(body.messages);
    if (messages.length === 0) return json({ ok: false, code: "messages_required" }, 400);
    const runtimeToken = await bindingValue(env.BLACKHOLE_RUNTIME_TOKEN, 500);
    if (!runtimeToken) return json({ ok: false, code: "runtime_binding_missing" }, 503);
    const runtimeBase = String(env.RUNTIME_URL || RUNTIME_URL).replace(/\/$/, "");
    const upstream = await fetchImpl(`${runtimeBase}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-runtime-token": runtimeToken },
      body: JSON.stringify({ text: promptFor(assistant, instructionsFor(assistant), messages) }),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return json({ ok: false, code: "runtime_failed", error: payload.error }, upstream.status);
    return json({ ok: true, tenantId: manifest.tenant_id, assistantId: assistant.assistant_id, response: String(payload.response ?? "") });
  }

  async function videoSession(request, env) {
    if (!env.VIDEO?.fetch) return json({ ok: false, code: "video_binding_missing" }, 503);
    const body = await request.json().catch(() => ({}));
    if (body.tenantId !== manifest.tenant_id) return json({ ok: false, code: "tenant_mismatch" }, 403);
    const assistant = assistantById(manifest, body.assistantId);
    if (!assistant) return json({ ok: false, code: "unknown_assistant" }, 404);
    const state = await readState(env, manifest, assistant);
    const origin = String(env.APP_ORIGIN || new URL(request.url).origin).replace(/\/$/, "");
    const avatarImageUrl = state.avatar?.uploaded
      ? `${origin}/assets/assistants/${assistant.assistant_id}/avatar`
      : state.avatar?.url;
    if (!avatarImageUrl) return json({ ok: false, code: "avatar_not_configured" }, 409);
    const capabilityToken = await bindingValue(env.BLACKHOLE_CAPABILITY_TOKEN, 500);
    if (!capabilityToken) return json({ ok: false, code: "capability_binding_missing" }, 503);
    const payload = {
      tenantId: manifest.tenant_id,
      product: manifest.tenant_id,
      creatorId: assistant.assistant_id,
      creatorName: assistant.display_name,
      creatorSlug: assistant.assistant_id,
      fanId: cleanSlug(body.metadata?.userId || crypto.randomUUID(), 63) || crypto.randomUUID(),
      fanName: String(body.metadata?.userName || "Demo user").slice(0, 120),
      avatarProvider: "lemonslice",
      avatarSource: "image-url",
      lemonsliceAgentId: "",
      avatarImageUrl,
      avatarPrompt: String(body.metadata?.avatarPrompt || "Maintain the original composition with natural attentive movement.").slice(0, 1_000),
      voiceProvider: "eila-runtime",
      voiceModel: "",
      voiceId: state.voice?.id || assistant.voice.id,
      instructions: String(instructionsFor(assistant)).slice(0, 5_000),
    };
    const upstream = await env.VIDEO.fetch(new Request("https://blackhole.internal/internal/video/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-blackhole-capability-token": capabilityToken },
      body: JSON.stringify(payload),
    }));
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || data.ok === false) {
      return json({ ok: false, code: "video_broker_failed", error: data.error }, upstream.ok ? 502 : upstream.status);
    }
    return json({ ...data, ok: true, tenantId: manifest.tenant_id, assistantId: assistant.assistant_id });
  }

  async function updateSettings(request, env) {
    const identity = await authorizeSettings(request, env);
    if (!identity) return json({ ok: false, code: "settings_forbidden" }, 403);
    if (!env.ASSISTANT_ASSETS?.put) return json({ ok: false, code: "asset_binding_missing" }, 503);
    const form = await request.formData();
    if (form.get("tenantId") !== manifest.tenant_id) return json({ ok: false, code: "tenant_mismatch" }, 403);
    const assistant = assistantById(manifest, form.get("assistantId"));
    if (!assistant) return json({ ok: false, code: "unknown_assistant" }, 404);
    const avatar = form.get("avatar");
    const voiceReference = form.get("voiceReference");
    if (!(avatar instanceof File) && !(voiceReference instanceof File)) {
      return json({ ok: false, code: "asset_required" }, 400);
    }
    const previous = await readState(env, manifest, assistant);
    const next = { ...previous, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), updatedBy: identity.email || identity.subject };

    if (avatar instanceof File) {
      if (avatar.size > MAX_IMAGE_BYTES) return json({ ok: false, code: "avatar_too_large" }, 413);
      const buffer = await avatar.arrayBuffer();
      if (!validImage(buffer, avatar.type)) return json({ ok: false, code: "invalid_avatar" }, 422);
      const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[avatar.type];
      const key = objectKey(manifest, assistant.assistant_id, `avatar-${next.revision}.${extension}`);
      const hash = await sha256Hex(buffer);
      await env.ASSISTANT_ASSETS.put(key, buffer, { httpMetadata: { contentType: avatar.type }, customMetadata: { sha256: hash } });
      next.avatar = { url: null, sha256: hash, uploaded: true, key, contentType: avatar.type };
    }

    if (voiceReference instanceof File) {
      if (voiceReference.size > MAX_VOICE_BYTES) return json({ ok: false, code: "voice_too_large" }, 413);
      const buffer = await voiceReference.arrayBuffer();
      let wav;
      try { wav = inspectVoiceWav(buffer); } catch (error) {
        return json({ ok: false, code: "invalid_voice", error: error.message }, 422);
      }
      const hash = await sha256Hex(buffer);
      const key = objectKey(manifest, assistant.assistant_id, `reference-${next.revision}.wav`);
      await env.ASSISTANT_ASSETS.put(key, buffer, { httpMetadata: { contentType: "audio/wav" }, customMetadata: { sha256: hash } });
      const runtimeToken = await bindingValue(env.BLACKHOLE_RUNTIME_TOKEN, 500);
      if (!runtimeToken) return json({ ok: false, code: "runtime_binding_missing" }, 503);
      const runtimeBase = String(env.RUNTIME_URL || RUNTIME_URL).replace(/\/$/, "");
      const activation = await fetchImpl(`${runtimeBase}/v1/admin/voice-reference/${encodeURIComponent(assistant.voice.id)}`, {
        method: "POST",
        headers: { "content-type": "audio/wav", "x-runtime-token": runtimeToken },
        body: buffer,
      });
      const activationResult = await activation.json().catch(() => ({}));
      if (!activation.ok || activationResult.ok === false) {
        return json({ ok: false, code: "voice_activation_failed", error: activationResult.detail || activationResult.error }, 502);
      }
      next.voice = { id: assistant.voice.id, reference_url: null, sha256: hash, activated: true, ...wav };
    }

    await env.ASSISTANT_ASSETS.put(
      objectKey(manifest, assistant.assistant_id, "settings.json"),
      JSON.stringify(next),
      { httpMetadata: { contentType: "application/json" } },
    );
    return json({ ok: true, tenantId: manifest.tenant_id, assistantId: assistant.assistant_id, settings: next });
  }

  async function avatarAsset(request, env, assistantId) {
    const assistant = assistantById(manifest, assistantId);
    if (!assistant || !env.ASSISTANT_ASSETS?.get) return new Response("Not found", { status: 404 });
    const state = await readState(env, manifest, assistant);
    if (!state.avatar?.key) return new Response("Not found", { status: 404 });
    const object = await env.ASSISTANT_ASSETS.get(state.avatar.key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = {
        "cache-control": "public, max-age=300",
        "content-type": object.httpMetadata?.contentType || state.avatar.contentType || "application/octet-stream",
        "x-content-type-options": "nosniff",
    };
    const etag = object.httpEtag || state.avatar.sha256;
    if (etag) headers.etag = etag;
    return new Response(object.body, { headers });
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const isTenantApi = ["/api/chat", "/api/video/session"].includes(url.pathname);
      if (request.method === "OPTIONS" && isTenantApi) {
        const headers = corsHeaders(request, manifest);
        return Object.keys(headers).length > 0
          ? new Response(null, { status: 204, headers })
          : json({ ok: false, code: "origin_forbidden" }, 403);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const [runtimeTokenConfigured, capabilityTokenConfigured] = await Promise.all([
          bindingConfigured(env.BLACKHOLE_RUNTIME_TOKEN),
          bindingConfigured(env.BLACKHOLE_CAPABILITY_TOKEN),
        ]);
        const assistants = await Promise.all(manifest.assistants.map(async (assistant) => {
          const state = await readState(env, manifest, assistant);
          return {
            id: assistant.assistant_id,
            voiceId: assistant.voice.id,
            avatarConfigured: Boolean(state.avatar?.uploaded || state.avatar?.url),
            voiceConfigured: Boolean(state.voice?.activated || state.voice?.reference_url || state.voice?.sha256),
          };
        }));
        const runtimeConfigured = String(env.RUNTIME_URL || RUNTIME_URL) === RUNTIME_URL;
        const videoBindingConfigured = Boolean(env.VIDEO?.fetch);
        const assetBindingConfigured = Boolean(env.ASSISTANT_ASSETS?.get);
        const reasons = [];
        if (!runtimeConfigured) reasons.push("canonical runtime URL drift");
        if (!runtimeTokenConfigured) reasons.push("BLACKHOLE_RUNTIME_TOKEN is not configured");
        if (!capabilityTokenConfigured) reasons.push("BLACKHOLE_CAPABILITY_TOKEN is not configured");
        if (!videoBindingConfigured) reasons.push("VIDEO service binding is not configured");
        if (!assetBindingConfigured) reasons.push("ASSISTANT_ASSETS binding is not configured");
        return json({
          ok: reasons.length === 0,
          healthContract: "blackhole-tenant-v1",
          service: `${manifest.tenant_id}-tenant-adapter`,
          planeId: PLANE_ID,
          tenantId: manifest.tenant_id,
          adapterVersion: manifest.adapter_version,
          runtimeConfigured,
          runtimeTokenConfigured,
          capabilityTokenConfigured,
          videoBindingConfigured,
          assetBindingConfigured,
          reasons,
          assistants,
        }, reasons.length === 0 ? 200 : 503);
      }
      if (request.method === "POST" && url.pathname === "/api/chat") return withCors(await chat(request, env), request, manifest);
      if (request.method === "POST" && url.pathname === "/api/video/session") return withCors(await videoSession(request, env), request, manifest);
      if (request.method === "POST" && url.pathname === "/settings/api/assistant-settings") {
        return updateSettings(request, env);
      }
      const avatarMatch = url.pathname.match(/^\/assets\/assistants\/([a-z0-9-]+)\/avatar$/);
      if (request.method === "GET" && avatarMatch) return avatarAsset(request, env, avatarMatch[1]);
      if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
      return json({ ok: false, code: "route_not_found" }, 404);
    },
  };
}

export { authorizeCloudflareAccess, inspectVoiceWav };
