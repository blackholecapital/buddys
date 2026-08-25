function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function basicAuth(accountSid, authToken) {
  return "Basic " + btoa(`${accountSid}:${authToken}`);
}

function normalizePhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

function resolveMessage(payload = {}) {
  return String(payload.message || payload.body || payload.text || payload.sms?.message || "").trim();
}

function resolvePhone(payload = {}) {
  return normalizePhone(payload.to || payload.phone || payload.contact?.phone || payload.lead?.phone || "");
}

function maskPhone(value = "") {
  const phone = normalizePhone(value);
  if (phone.length < 4) return phone;
  return `${phone.slice(0, 3)}••••${phone.slice(-4)}`;
}

async function emit(env, event) {
  if (!env.EVENTS) return;
  try { await env.EVENTS.send({ ...event, ts:Date.now() }); } catch (error) { console.error("Buddy SMS event emit failed", error); }
}

async function parseRequestBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json().catch(() => ({}));
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(await request.text()));
  const text = await request.text();
  try { return JSON.parse(text); } catch { return { raw:text }; }
}

async function sendSms(env, payload = {}) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || "");
  const authToken = String(env.TWILIO_AUTH_TOKEN || "");
  const from = normalizePhone(env.TWILIO_PHONE_NUMBER || "");
  const to = resolvePhone(payload);
  const message = resolveMessage(payload);
  const contactId = String(payload.contactId || payload.contact?.id || "");
  const messageType = String(payload.messageType || "buddy-sms");

  if (!accountSid || !authToken || !from) return json({ ok:false, error:"Twilio SMS credentials are not configured" }, 503);
  if (!to) return json({ ok:false, error:"Missing SMS destination phone number" }, 400);
  if (!message) return json({ ok:false, error:"Missing SMS message body" }, 400);

  const publicBase = String(env.PUBLIC_BASE_URL || "https://buddys-sms-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/, "");
  const callback = new URL(`${publicBase}/twilio/status`);
  if (contactId) callback.searchParams.set("contactId", contactId);
  if (messageType) callback.searchParams.set("messageType", messageType);

  const body = new URLSearchParams();
  body.set("To", to);
  body.set("From", from);
  body.set("Body", message);
  body.set("StatusCallback", callback.toString());

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method:"POST",
    headers:{ Authorization:basicAuth(accountSid, authToken), "content-type":"application/x-www-form-urlencoded" },
    body:body.toString(),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Buddy SMS Twilio API rejected", { status:response.status, code:result.code || null, message:result.message || "Twilio SMS request failed", from:maskPhone(from), to:maskPhone(to), messageType, contactId });
    await emit(env, { type:"sms.failed", contactId, messageType, to:maskPhone(to), provider:"twilio", providerCode:result.code || null, error:result.message || "Twilio SMS request failed" });
    return json({ ok:false, provider:"twilio", status:response.status, code:result.code || null, error:result.message || "Twilio SMS request failed", from:maskPhone(from), to:maskPhone(to) }, response.status);
  }

  console.log("Buddy SMS accepted by Twilio", { sid:result.sid || "", from:maskPhone(from), to:maskPhone(to), twilioStatus:result.status || "queued", messageType, contactId });
  await emit(env, { type:"sms.sent", contactId, messageType, messageSid:result.sid || "", status:result.status || "queued", to:maskPhone(to), provider:"twilio", message });

  return json({ ok:true, provider:"twilio", messageSid:result.sid || "", status:result.status || "queued", from:maskPhone(from), to:maskPhone(to), messageType });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/api/health") {
      const from = normalizePhone(env.TWILIO_PHONE_NUMBER || "");
      return json({ ok:true, service:"buddys-sms-worker", provider:"twilio", health:"online", configured:Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER), fromNumberMasked:maskPhone(from), fromLast4:from.slice(-4) });
    }

    if (url.pathname === "/internal/send" && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      return sendSms(env, payload);
    }

    if (url.pathname === "/twilio/status" && request.method === "POST") {
      const body = await parseRequestBody(request);
      const status = body.MessageStatus || body.SmsStatus || body.status || "unknown";
      const sid = body.MessageSid || body.SmsSid || body.sid || "";
      const errorCode = body.ErrorCode || body.error_code || "";
      const errorMessage = body.ErrorMessage || body.error_message || "";
      const contactId = url.searchParams.get("contactId") || "";
      const messageType = url.searchParams.get("messageType") || "buddy-sms";
      console.log("Buddy SMS delivery status", { sid, status, errorCode:errorCode || null, errorMessage:errorMessage || null, from:maskPhone(body.From || ""), to:maskPhone(body.To || ""), contactId, messageType });
      await emit(env, { type:`sms.${status}`, contactId, messageType, messageSid:sid, status, to:maskPhone(body.To || ""), provider:"twilio", errorCode:errorCode || "", error:errorMessage || "" });
      return json({ ok:true });
    }

    return json({ ok:false, error:"Route not found", path:url.pathname }, 404);
  },
};
