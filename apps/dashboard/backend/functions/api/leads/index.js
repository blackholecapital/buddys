const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

function scoreLead(body = {}) {
  let score = 0;
  if (body.first_name || body.firstName) score += 10;
  if (body.last_name || body.lastName) score += 10;
  if (body.phone) score += 20;
  if (body.email) score += 10;
  if (body.product_interest) score += 15;
  if (body.preferred_store) score += 10;
  if (body.contact_method) score += 10;
  if (body.contact_time) score += 5;
  if (String(body.comments || "").trim()) score += 5;
  if (body.consent === true || body.consent === "true" || body.consent === "on") score += 5;
  return Math.min(score, 100);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function buildCallNowUrl(env, contactId) {
  if (!env.INTERNAL_CALL_SECRET || !contactId) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(env.INTERNAL_CALL_SECRET)),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`buddy-call:${contactId}`));
  const sig = base64Url(new Uint8Array(signature));
  const base = String(env.DASHBOARD_PUBLIC_URL || "https://buddys-dashboard-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/, "");
  return `${base}/api/call-now?id=${encodeURIComponent(contactId)}&sig=${encodeURIComponent(sig)}`;
}

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const leadScore = scoreLead(body);
  const preferredContactMethod = body.contact_method || body.preferredContactMethod || "";

  let contact = contacts.create({
    firstName: body.first_name || body.firstName || "",
    lastName: body.last_name || body.lastName || "",
    email: body.email || "",
    phone: body.phone || "",
    channelPreference: preferredContactMethod === "Email" ? "email" : "sms",
    interest: body.product_interest || "",
    leadSource: body.lead_source || "",
    location: body.preferred_store || "",
    preferredContactMethod,
    preferredContactTime: body.contact_time || "",
    comments: body.comments || "",
    smsConsent: body.consent === true || body.consent === "true" || body.consent === "on",
    owner: body.owner || "Buddy Web Lead",
    company: body.company || "Buddy's Home Furnishings",
    source: "Buddy web lead",
    leadScore,
    stage: "New Lead",
    outreachStatus: "Pending",
    callStatus: "Not called",
    documentStatus: "Not sent"
  });

  activity.record({
    type:"lead.created",
    entityType:"lead",
    entityId:contact.id,
    message:`Buddy web lead: ${contact.firstName} ${contact.lastName}`,
    metadata:{ ...body, leadScore }
  });

  const callNowUrl = contact.email ? await buildCallNowUrl(env, contact.id) : "";

  let concierge = null;
  try {
    concierge = await conciergePost(env, "/internal/leads", {
      contactId:contact.id,
      contact,
      lead:{ ...body, leadScore },
      callback:{ callNowUrl, persistent:true, source:"buddy-email" },
    });
  } catch(err) {
    concierge = { ok:false, error:err.message };
  }

  const smsSent = concierge?.results?.sms?.ok === true;
  const emailSent = concierge?.results?.email?.ok === true;
  if (smsSent || emailSent) {
    contact = contacts.update(contact.id, {
      stage:"Contacted",
      outreachStatus:"Sent",
      outreachChannels:[smsSent ? "sms" : null, emailSent ? "email" : null].filter(Boolean),
    }) || contact;
    activity.record({
      type:"lead.contacted",
      entityType:"lead",
      entityId:contact.id,
      message:`Buddy outreach sent to ${contact.firstName || contact.phone || contact.email}`,
      metadata:{ smsSent, emailSent, preferredContactMethod, contactFlow:concierge?.contactFlow || null },
    });
  }

  return {
    ok:true,
    contact,
    leadScore,
    concierge,
    contactFlow: concierge?.contactFlow || null,
    callNowUrl: callNowUrl || undefined,
  };
};
