const activity = require("../../../layers/domain/activity");
const { readDb } = require("../../../layers/core/db");
const { conciergePost } = require("../../../../shared/services/concierge");
const rateLimits = require("../../../layers/domain/rateLimits");

const { verify } = require("../../../../shared/services/video-session-auth");

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const contactId = String(body?.contactId || "").trim();
  const sessionId = String(body?.sessionId || "").trim();
  const suppliedToken = String(body?.workflowToken || "").trim();
  const contact = readDb().contacts.find((row) => row && row.id === contactId);
  if (!await verify(env?.INTERNAL_CALL_SECRET, suppliedToken, contact, "workflow", sessionId)) {
    return { ok:false, error:"Invalid or expired video workflow session" };
  }

  const action = String(body?.action || "").trim().toLowerCase();
  if (action !== "contact-status") {
    const guard = rateLimits.checkAndTrack(`buddy-video-action:${contactId}`);
    if (!guard.allowed) return { ok:false, error:`Workflow action limit reached. ${guard.reason}` };
  }

  if (action === "contact-status") {
    return conciergePost(env, "/internal/contact-status", { contactId });
  }

  if (action === "category-selected") {
    return conciergePost(env,"/internal/showroom/category",{contactId,category:body?.category});
  }

  if (action === "product-selected") {
    const optionIndex = Number(body?.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 1) {
      return { ok:false, error:"Choose product option 1 or 2" };
    }
    const result = await conciergePost(env, "/internal/product-selected", { contactId, optionIndex, productId:body?.productId, catalogVersion:body?.catalogVersion });
    if (result.ok && result.product?.id) {
      const eventKey=`product.selected:${result.docusign?.envelopeId || result.product.id}`;
      if (!(readDb().activities||[]).some(a=>a.entityId===contactId && a.metadata?.eventKey===eventKey)) activity.record({
        type:"product.selected",entityType:"contact",entityId:contactId,message:`${result.product.name} selected`,
        metadata:{eventKey,productId:result.product.id,sessionId,source:"commerce-server",envelopeId:result.docusign?.envelopeId || ""},
      });
    }
    return result;
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
