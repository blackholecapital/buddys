import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";

const TENANT_ID = "buddys";
const RELAY_TTL_SECONDS = 600;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
  },
});

const cleanId = (value, max = 96) => String(value || "")
  .replace(/[^a-zA-Z0-9_-]/g, "")
  .slice(0, max);

const required = (value, name, max = 5000) => {
  const output = String(value || "").trim().slice(0, max);
  if (!output) throw new Error(`${name} is required`);
  return output;
};

export async function bindingValue(binding, max = 5000) {
  const value = binding && typeof binding.get === "function" ? await binding.get() : binding;
  return String(value || "").trim().slice(0, max);
}

async function requiredBinding(binding, name, max = 5000) {
  const value = await bindingValue(binding, max);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function apiHeaderValue(value, name = "API key") {
  const raw = String(value || "");
  const normalized = raw.replace(/[^\x21-\x7E]/g, "");
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length !== raw.length) {
    console.warn("PROVIDER_KEY_NORMALIZED", {
      name,
      originalLength:raw.length,
      normalizedLength:normalized.length,
    });
  }
  return normalized;
}

async function capabilitySecret(env) {
  const dedicated = await bindingValue(env.BLACKHOLE_BUDDYS_CAPABILITY_TOKEN, 500);
  return requiredBinding(
    dedicated || env.BLACKHOLE_CAPABILITY_TOKEN,
    dedicated ? "BLACKHOLE_BUDDYS_CAPABILITY_TOKEN" : "BLACKHOLE_CAPABILITY_TOKEN",
    500,
  );
}

async function liveKitConfig(env) {
  const [apiKey, apiSecret] = await Promise.all([
    requiredBinding(env.LIVEKIT_API_KEY, "LIVEKIT_API_KEY", 500),
    requiredBinding(env.LIVEKIT_API_SECRET, "LIVEKIT_API_SECRET", 1000),
  ]);
  const agentName = required(env.VIDEO_AGENT_NAME, "VIDEO_AGENT_NAME", 160);
  const wsUrl = required(env.LIVEKIT_URL, "LIVEKIT_URL", 1000);
  const httpUrl = new URL(wsUrl);
  if (httpUrl.protocol === "wss:") httpUrl.protocol = "https:";
  else if (httpUrl.protocol === "ws:") httpUrl.protocol = "http:";
  if (!["https:", "http:"].includes(httpUrl.protocol)) throw new Error("LIVEKIT_URL must use ws(s) or http(s)");
  return { apiKey, apiSecret, agentName, wsUrl, httpUrl:httpUrl.origin };
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function relayToken(env, room) {
  const expiresAt = Math.floor(Date.now() / 1000) + RELAY_TTL_SECONDS;
  const signature = await hmac(await capabilitySecret(env), `${TENANT_ID}|${room}|${expiresAt}`);
  return `bh1.${expiresAt}.${signature}`;
}

async function authorizeRelay(request, env, room) {
  const token = String(request.headers.get("x-api-key") || "").trim();
  const [version, expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  if (
    version !== "bh1"
    || !Number.isInteger(expiresAt)
    || expiresAt < now
    || expiresAt > now + RELAY_TTL_SECONDS + 60
    || !signature
  ) return false;
  const expected = await hmac(await capabilitySecret(env), `${TENANT_ID}|${room}|${expiresAt}`);
  return signature === expected;
}

export function normalizeSession(body = {}) {
  const tenantId = cleanId(body.tenantId || body.tenant_id, 64);
  if (tenantId !== TENANT_ID) throw new Error("tenantId must be buddys");

  const creatorId = cleanId(body.creatorId || body.creator_id, 64);
  const fanId = cleanId(body.fanId || body.fan_id || crypto.randomUUID(), 96) || crypto.randomUUID();
  const avatarProvider = required(body.avatarProvider || body.avatar_provider, "avatarProvider", 64).toLowerCase();
  const avatarSource = required(body.avatarSource || body.avatar_source, "avatarSource", 64).toLowerCase();
  const voiceProvider = required(body.voiceProvider || body.voice_provider, "voiceProvider", 64).toLowerCase();
  const voiceModel = String(body.voiceModel || body.voice_model || "").trim().slice(0, 160);
  const voiceId = required(body.voiceId || body.voice_id, "voiceId", 160);
  const agentId = String(body.lemonsliceAgentId || body.lemonslice_agent_id || "").trim().slice(0, 240);
  const imageUrl = String(body.avatarImageUrl || body.avatar_image_url || "").trim().slice(0, 2000);

  if (!creatorId) throw new Error("creatorId is required");
  if (avatarProvider !== "lemonslice") throw new Error("avatarProvider must be lemonslice");
  if (!["agent-id", "image-url"].includes(avatarSource)) throw new Error("avatarSource must be agent-id or image-url");
  if (avatarSource === "agent-id" && !agentId) throw new Error("lemonsliceAgentId is required");
  if (avatarSource === "image-url" && !imageUrl) throw new Error("avatarImageUrl is required");
  if (voiceProvider !== "eila-runtime") throw new Error("voiceProvider must be eila-runtime");

  return {
    tenantId,
    creatorId,
    fanId,
    creatorName:String(body.creatorName || body.creator_name || "Buddy").trim().slice(0, 120),
    creatorSlug:String(body.creatorSlug || body.creator_slug || creatorId).trim().slice(0, 120),
    fanName:String(body.fanName || body.fan_name || "Customer").trim().slice(0, 120),
    avatarProvider,
    avatarSource,
    agentId,
    imageUrl,
    avatarPrompt:String(body.avatarPrompt || body.avatar_prompt || "").trim().slice(0, 500),
    avatarIdlePrompt:String(body.avatarIdlePrompt || body.avatar_idle_prompt || "").trim().slice(0, 500),
    voiceProvider,
    voiceModel,
    voiceId,
    instructions:required(body.instructions, "instructions"),
  };
}

async function createSession(request, env) {
  const body = await request.json().catch(() => ({}));
  const supplied = String(request.headers.get("x-blackhole-capability-token") || "");
  if (!supplied || supplied !== await capabilitySecret(env)) {
    return json({ ok:false, error:"Unauthorized" }, 401);
  }

  const input = normalizeSession(body);
  const livekit = await liveKitConfig(env);
  const room = `bh-buddys-${input.creatorId}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const relay = await relayToken(env, room);
  const metadata = {
    tenant_id:TENANT_ID,
    creator_id:input.creatorId,
    creator_name:input.creatorName,
    creator_slug:input.creatorSlug,
    fan_id:input.fanId,
    avatar_provider:input.avatarProvider,
    avatar_source:input.avatarSource,
    lemonslice_agent_id:input.avatarSource === "agent-id" ? input.agentId : "",
    avatar_image_url:input.avatarSource === "image-url" ? input.imageUrl : "",
    avatar_prompt:input.avatarPrompt,
    avatar_idle_prompt:input.avatarIdlePrompt,
    voice_provider:input.voiceProvider,
    voice_model:input.voiceModel,
    voice_id:input.voiceId,
    instructions:input.instructions,
    relay_room:room,
    relay_token:relay,
  };

  console.log("BUDDY_SESSION_REQUEST", { room, creatorId:input.creatorId, agentName:livekit.agentName });
  const dispatchClient = new AgentDispatchClient(livekit.httpUrl, livekit.apiKey, livekit.apiSecret);
  const dispatch = await dispatchClient.createDispatch(room, livekit.agentName, {
    metadata:JSON.stringify(metadata),
  });

  const participant = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity:`member-buddys-${input.fanId}`.slice(0, 120),
    ttl:3600,
    name:input.fanName,
  });
  participant.addGrant({ roomJoin:true, room, canPublish:true, canSubscribe:true, canPublishData:true });

  console.log("BUDDY_DISPATCH_OK", { room, dispatchId:dispatch?.id || null, agentName:livekit.agentName });
  return json({
    ok:true,
    mode:"browser",
    livekitUrl:livekit.wsUrl,
    token:await participant.toJwt(),
    room,
    dispatchId:dispatch?.id || null,
    tenantId:TENANT_ID,
    creatorId:input.creatorId,
    fanId:input.fanId,
    agentName:livekit.agentName,
  });
}

async function relayLemonSlice(request, env, url) {
  const tenantId = cleanId(url.searchParams.get("tenant"), 64);
  const room = cleanId(url.searchParams.get("room"), 160);
  if (tenantId !== TENANT_ID || !room) return json({ ok:false, error:"tenant=buddys and room are required" }, 400);
  if (!(await authorizeRelay(request, env, room))) return json({ ok:false, error:"Unauthorized" }, 401);

  const providerKey = apiHeaderValue(
    await requiredBinding(env.LEMONSLICE_BUDDYS_API_KEY, "LEMONSLICE_BUDDYS_API_KEY", 1000),
    "LEMONSLICE_BUDDYS_API_KEY",
  );
  const body = new Uint8Array(await request.arrayBuffer());
  const upstream = await fetch(String(env.LEMONSLICE_API_URL || "https://lemonslice.com/api/liveai/sessions"), {
    method:"POST",
    headers:{
      "x-api-key":providerKey,
      "content-type":request.headers.get("content-type") || "application/json",
      accept:"application/json",
    },
    body,
  });
  console.log("BUDDY_LEMONSLICE_STATUS", { room, status:upstream.status });
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status:upstream.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const [livekitApiKey, livekitApiSecret, lemonSliceKey] = await Promise.all([
        bindingValue(env.LIVEKIT_API_KEY, 500).catch(() => ""),
        bindingValue(env.LIVEKIT_API_SECRET, 1000).catch(() => ""),
        bindingValue(env.LEMONSLICE_BUDDYS_API_KEY, 1000).catch(() => ""),
      ]);
      return json({
        ok:true,
        service:"buddys-video-worker",
        version:"buddy-owned-v1",
        tenant:TENANT_ID,
        livekitConfigured:Boolean(env.LIVEKIT_URL && livekitApiKey && livekitApiSecret),
        lemonsliceConfigured:Boolean(lemonSliceKey),
        agentName:String(env.VIDEO_AGENT_NAME || ""),
        relayAuth:"room-scoped-hmac",
      });
    }
    try {
      if (request.method === "POST" && url.pathname === "/internal/video/session") {
        return await createSession(request, env);
      }
      if (request.method === "POST" && url.pathname === "/internal/lemonslice/sessions") {
        return await relayLemonSlice(request, env, url);
      }
      return json({ ok:false, error:"route not found" }, 404);
    } catch (error) {
      console.error("BUDDY_VIDEO_WORKER_ERROR", error instanceof Error ? error.message : String(error));
      return json({ ok:false, error:error instanceof Error ? error.message : "video worker failure" }, 500);
    }
  },
};
