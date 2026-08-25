import { handleTwilioMediaSocket } from "./media.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function xml(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactParam(value = "", max = 240) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function basicAuth(accountSid, authToken) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

async function secretsEqual(a, b) {
  const left = await sha256(a);
  const right = await sha256(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function authorizeInternalCall(request, env) {
  const configured = env.INTERNAL_CALL_SECRET || "";
  if (!configured) return { ok:false, response:json({ ok:false, error:"Internal call authentication is not configured" }, 503) };
  const provided = request.headers.get("x-internal-call-secret") || "";
  if (!provided || !(await secretsEqual(provided, configured))) return { ok:false, response:json({ ok:false, error:"Unauthorized" }, 401) };
  return { ok:true };
}

async function parseBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await request.json();
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(await request.text()));
  const text = await request.text();
  try { return JSON.parse(text); } catch { return { raw:text }; }
}

async function emitEvent(env, event) {
  try { if (env.EVENTS) await env.EVENTS.send({ ...event, ts:Date.now() }); } catch (error) { console.error("queue event failed", error); }
  try {
    if (env.ANALYTICS) env.ANALYTICS.writeDataPoint({ blobs:[event.type || "voice.event", event.contactId || "", event.callSid || ""], doubles:[Date.now()] });
  } catch (error) { console.error("analytics event failed", error); }
}

async function validateTwilioFormRequest(request, env, body) {
  const authToken = String(env.TWILIO_AUTH_TOKEN || "");
  const provided = String(request.headers.get("x-twilio-signature") || "");
  if (!authToken || !provided) return false;
  const url = new URL(request.url);
  const canonicalUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
  const keys = Object.keys(body || {}).sort();
  let signed = canonicalUrl;
  for (const key of keys) signed += `${key}${body[key] ?? ""}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name:"HMAC", hash:"SHA-1" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  const expected = btoa(binary);
  return expected === provided;
}

async function forwardSmsReply(env, body) {
  const secret = String(env.INTERNAL_CALL_SECRET || "");
  if (!secret) throw new Error("INTERNAL_CALL_SECRET is not configured");

  const payload = {
    from:body.From || body.from || "",
    body:body.Body || body.body || "",
    messageSid:body.MessageSid || "",
  };

  const request = new Request("https://concierge.internal/internal/sms-reply", {
    method:"POST",
    headers:{ "content-type":"application/json", "x-internal-call-secret":secret },
    body:JSON.stringify(payload),
  });

  const response = env.CONCIERGE
    ? await env.CONCIERGE.fetch(request)
    : await fetch("https://blackhole-concierge-worker.cryptocapitalgroupfl.workers.dev/internal/sms-reply", {
        method:"POST",
        headers:{ "content-type":"application/json", "x-internal-call-secret":secret },
        body:JSON.stringify(payload),
      });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
  if (!response.ok) {
    console.error("Concierge SMS reply handoff rejected", {
      status:response.status,
      body:data,
      via:env.CONCIERGE ? "service-binding" : "public-fetch",
    });
    throw new Error(data?.error || `Concierge SMS reply failed (${response.status})`);
  }
  return data;
}

function buildRealtimeTwiml(env, context) {
  const streamUrl = String(env.MEDIA_STREAM_URL || "").trim();
  if (!streamUrl.startsWith("wss://")) return null;
  const streamStatusUrl = `${env.PUBLIC_BASE_URL}/twilio/stream-status`;
  const params = [
    ["contactId", context.contactId], ["firstName", context.firstName], ["lastName", context.lastName],
    ["email", context.email], ["phone", context.phone], ["interest", context.interest], ["location", context.location],
    ["comments", context.comments], ["leadScore", context.leadScore], ["preferredContactTime", context.preferredContactTime],
  ];
  const customParameters = params
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .map(([name, value]) => `      <Parameter name="${escapeXml(name)}" value="${escapeXml(compactParam(value))}"/>`)
    .join("\n");
  return `<Response>\n  <Connect>\n    <Stream url="${escapeXml(streamUrl)}" statusCallback="${escapeXml(streamStatusUrl)}" statusCallbackMethod="POST">\n${customParameters}\n    </Stream>\n  </Connect>\n</Response>`;
}

function buildFallbackTwiml(context) {
  return `<Response><Pause length="1"/><Say voice="Polly.Joanna">Hi ${escapeXml(context.firstName)}. This is Buddy, your personal shopping assistant from Buddy's Home Furnishings. I saw that you're interested in ${escapeXml(context.interest)}. I'm calling because you asked to speak with me. The live conversational assistant is connecting now.</Say><Pause length="1"/><Say voice="Polly.Joanna">Thanks. This test confirms that your lead information successfully reached the voice system.</Say></Response>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/twilio/media") return handleTwilioMediaSocket(request, env, ctx);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok:true, service:"blackhole-voice-worker", status:"online", voice:"twilio", realtime:String(env.MEDIA_STREAM_URL || "").startsWith("wss://") ? "configured" : "fallback", mediaBridge:"ready", conciergeBinding:Boolean(env.CONCIERGE) });
    }

    if (url.pathname === "/twilio/sms" && request.method === "POST") {
      const body = await parseBody(request);
      if (!(await validateTwilioFormRequest(request, env, body))) return xml("<Response></Response>", 403);
      try {
        const result = await forwardSmsReply(env, body);
        console.log("Buddy inbound SMS processed", { from:body.From || "", body:body.Body || "", action:result?.action || "none" });
        return xml("<Response></Response>");
      } catch (error) {
        console.error("Buddy inbound SMS failed", { from:body.From || "", error:error.message });
        return xml("<Response></Response>");
      }
    }

    if (url.pathname === "/internal/calls" && request.method === "POST") {
      const auth = await authorizeInternalCall(request, env);
      if (!auth.ok) return auth.response;
      const payload = await parseBody(request);
      const ctxIn = payload.context || {};
      const contact = payload.contact || {};
      const lead = payload.lead || {};
      const phone = payload.phone || contact.phone || ctxIn.phone || lead.phone;
      if (!phone) return json({ ok:false, error:"Missing customer phone number" }, 400);
      const contactId = payload.contactId || contact.id || ctxIn.contactId || "";
      const firstName = payload.firstName || contact.firstName || ctxIn.firstName || payload.name?.split?.(" ")?.[0] || "there";
      const lastName = payload.lastName || contact.lastName || ctxIn.lastName || "";
      const email = payload.email || contact.email || ctxIn.email || lead.email || "";
      const interest = payload.interest || payload.productInterest || contact.interest || ctxIn.interest || lead.product_interest || lead.interest || "your recent inquiry";
      const location = payload.location || payload.preferredStore || contact.location || ctxIn.location || lead.preferred_store || "";
      const leadScore = payload.leadScore ?? payload.score ?? contact.leadScore ?? ctxIn.leadScore ?? "";
      const comments = payload.comments || contact.comments || ctxIn.comments || lead.comments || "";
      const preferredContactTime = payload.preferredContactTime || contact.preferredContactTime || ctxIn.preferredContactTime || lead.contact_time || "";
      const accountSid = env.TWILIO_ACCOUNT_SID;
      const authToken = env.TWILIO_AUTH_TOKEN;
      const fromNumber = env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromNumber) return json({ ok:false, error:"Twilio secrets are not configured" }, 500);
      const context = { contactId, firstName, lastName, email, phone, interest, location, comments, leadScore, preferredContactTime };
      const realtimeTwiml = buildRealtimeTwiml(env, context);
      const twiml = realtimeTwiml || buildFallbackTwiml(context);
      const mode = realtimeTwiml ? "media-stream" : "fallback-say";
      const callbackUrl = `${env.PUBLIC_BASE_URL}/twilio/status?contactId=${encodeURIComponent(contactId)}`;
      const params = new URLSearchParams();
      params.set("To", phone); params.set("From", fromNumber); params.set("Twiml", twiml); params.set("StatusCallback", callbackUrl); params.set("StatusCallbackMethod", "POST");
      for (const eventName of ["initiated", "ringing", "answered", "completed"]) params.append("StatusCallbackEvent", eventName);
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
        method:"POST", headers:{ Authorization:basicAuth(accountSid, authToken), "content-type":"application/x-www-form-urlencoded" }, body:params.toString(),
      });
      const result = await response.json();
      if (!response.ok) {
        console.error("Twilio call failed", result);
        await emitEvent(env, { type:"call.failed", contactId, phone, error:result.message || "Twilio call failed", mode });
        return json({ ok:false, error:"Twilio call creation failed", twilio:result }, response.status);
      }
      await emitEvent(env, { type:"call.created", contactId, callSid:result.sid, phone, interest, location, leadScore:String(leadScore), comments, mode });
      return json({ ok:true, provider:"twilio", callSid:result.sid, status:result.status, contactId, phone, mode, context });
    }

    if (url.pathname === "/twilio/status" && request.method === "POST") {
      const body = await parseBody(request);
      const contactId = url.searchParams.get("contactId") || "";
      const callSid = body.CallSid || body.callSid || "";
      const status = body.CallStatus || body.callStatus || "unknown";
      await emitEvent(env, { type:`call.${status}`, contactId, callSid, status, duration:body.CallDuration || body.Duration || "" });
      console.log("Twilio call status", { contactId, callSid, status });
      return json({ ok:true });
    }

    if (url.pathname === "/twilio/stream-status" && request.method === "POST") {
      const body = await parseBody(request);
      const streamEvent = body.StreamEvent || "unknown";
      const callSid = body.CallSid || "";
      const streamSid = body.StreamSid || "";
      await emitEvent(env, { type:`stream.${streamEvent}`, callSid, streamSid, streamEvent, streamError:body.StreamError || "" });
      console.log("Twilio stream status", { callSid, streamSid, streamEvent, streamError:body.StreamError || "" });
      return json({ ok:true });
    }

    if (url.pathname === "/twilio/answer") {
      const realtimeTwiml = buildRealtimeTwiml(env, { contactId:"", firstName:"there", interest:"your recent inquiry", location:"", leadScore:"" });
      if (realtimeTwiml) return xml(realtimeTwiml);
      return xml(`<Response><Say voice="Polly.Joanna">Buddy voice service is online.</Say></Response>`);
    }

    return json({ ok:false, error:"Route not found", path:url.pathname }, 404);
  },
};