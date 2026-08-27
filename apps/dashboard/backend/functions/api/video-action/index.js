const { readDb } = require("../../../layers/core/db");
const { conciergePost } = require("../../../../shared/services/concierge");
const rateLimits = require("../../../layers/domain/rateLimits");

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(secret, contactId, sessionId) {
  if (!secret || !contactId || !sessionId) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${contactId}:${sessionId}`),
  )));
}

async function safeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] || 0) ^ (b[index] || 0);
  }
  return mismatch === 0;
}

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const contactId = String(body?.contactId || "").trim();
  const sessionId = String(body?.sessionId || "").trim();
  const suppliedToken = String(body?.workflowToken || "").trim();
  const expectedToken = await sign(env.INTERNAL_CALL_SECRET, contactId, sessionId);
  if (!expectedToken || !(await safeEqual(suppliedToken, expectedToken))) {
    return { ok:false, error:"Invalid video workflow session" };
  }

  const contact = readDb().contacts.find((row) => row && row.id === contactId);
  if (!contact) return { ok:false, error:"Contact not found" };

  const action = String(body?.action || "").trim().toLowerCase();
  if (action !== "contact-status") {
    const guard = rateLimits.checkAndTrack(`buddy-video-action:${contactId}`);
    if (!guard.allowed) return { ok:false, error:`Workflow action limit reached. ${guard.reason}` };
  }

  if (action === "contact-status") {
    return conciergePost(env, "/internal/contact-status", { contactId });
  }

  if (action === "product-selected") {
    const optionIndex = Number(body?.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 1) {
      return { ok:false, error:"Choose product option 1 or 2" };
    }
    return conciergePost(env, "/internal/product-selected", { contactId, optionIndex });
  }

  if (action === "delivery-options") {
    return conciergePost(env, "/internal/delivery-options", { contactId });
  }

  if (action === "delivery-schedule") {
    const optionIndex = Number(body?.optionIndex);
    const available = await conciergePost(env, "/internal/delivery-options", { contactId });
    if (available?.ok === false) return available;
    const option = Array.isArray(available?.options) ? available.options[optionIndex] : null;
    if (!option) return { ok:false, error:"That delivery choice is no longer available" };
    return conciergePost(env, "/internal/delivery-schedule", {
      contactId,
      startIso:option.startIso,
      endIso:option.endIso,
      timeZone:option.timeZone || available.timeZone,
    });
  }

  return { ok:false, error:"Unsupported video workflow action" };
};
