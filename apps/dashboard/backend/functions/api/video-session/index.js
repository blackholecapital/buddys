const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { readDb } = require("../../../layers/core/db");
const { conciergePost } = require("../../../../shared/services/concierge");
const rateLimits = require("../../../layers/domain/rateLimits");

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function workflowToken(secret, contactId, sessionId) {
  if (!secret || !contactId || !sessionId) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${contactId}:${sessionId}`),
  );
  return base64url(new Uint8Array(signature));
}

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const guard = rateLimits.checkAndTrack("buddy-video");
  if (!guard.allowed) return { ok:false, error:`Video demo limit reached. ${guard.reason}. Please try again shortly.` };

  const contactId = String(body?.contactId || "").trim();
  const contact = contactId
    ? readDb().contacts.find((row) => row && row.id === contactId) || null
    : null;

  if (contactId && !contact) return { ok:false, error:"Contact not found" };

  const context = contact || {
    firstName:String(body?.firstName || "").slice(0,80),
    lastName:String(body?.lastName || "").slice(0,80),
    interest:String(body?.interest || "").slice(0,160),
    location:String(body?.location || "").slice(0,120),
    comments:String(body?.comments || "").slice(0,600),
    leadScore:Number(body?.leadScore || 0),
  };

  if (contact) {
    contacts.update(contact.id, { stage:"Engaged", callStatus:"Video requested" });
    activity.record({
      type:"video.requested",
      entityType:"contact",
      entityId:contact.id,
      message:`Buddy live video requested for ${contact.firstName || contact.email || contact.phone}`,
      metadata:{ source:body?.source || "buddy-web", interest:contact.interest, location:contact.location },
    });
  }

  try {
    const result = await conciergePost(env, "/internal/video/session", {
      contactId,
      contact:contact || context,
      context,
      source:body?.source || (contactId ? "lead-form" : "direct"),
    });
    if (result?.ok === false) return { ok:false, error:result.error || "Video session failed" };
    const sessionId = String(result.dispatchId || result.sessionId || result.room || "");
    return {
      ok:true,
      ...result,
      workflowToken:await workflowToken(env.INTERNAL_CALL_SECRET, contactId, sessionId),
    };
  } catch (error) {
    return { ok:false, error:error.message || "Unable to create Buddy video room" };
  }
};
