const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signContactId(secret, contactId) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`buddy-call:${contactId}`));
  return base64Url(new Uint8Array(signature));
}

async function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

module.exports = async function handler({ method, params, env }) {
  if (method !== "GET") return { ok:false, error:"GET only" };

  const contactId = String(params.id || "");
  const provided = String(params.sig || "");
  if (!contactId || !provided || !env.INTERNAL_CALL_SECRET) {
    return { ok:false, error:"Invalid call link" };
  }

  const expected = await signContactId(env.INTERNAL_CALL_SECRET, contactId);
  if (!(await safeEqual(provided, expected))) {
    return { ok:false, error:"Invalid call link" };
  }

  const contact = contacts.list().find((row) => row && row.id === contactId) || null;
  if (!contact) return { ok:false, error:"Contact not found" };
  if (!contact.phone) return { ok:false, error:"No phone number is available for this request" };
  if (contact.optedOut) return { ok:false, error:"This contact has opted out" };

  activity.record({
    type:"call.requested",
    entityType:"contact",
    entityId:contact.id,
    message:`Buddy email call-now requested for ${contact.firstName || contact.phone}`,
    metadata:{ source:"buddy-email-call-link" },
  });

  try {
    const result = await conciergePost(env, "/internal/calls", {
      contactId:contact.id,
      contact,
      trigger:{ type:"email-call-link", preferredContactMethod:"Email" },
    });
    return {
      ok:true,
      message:"Buddy is calling you now. You can close this page.",
      contactId:contact.id,
      call:result,
    };
  } catch (error) {
    return { ok:false, error:error.message || "Unable to start Buddy call" };
  }
};
