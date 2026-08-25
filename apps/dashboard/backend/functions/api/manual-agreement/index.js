const { readDb } = require("../../../layers/core/db");
const activity = require("../../../layers/domain/activity");
const { conciergePost } = require("../../../../shared/services/concierge");

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const contactId = String(body?.contactId || "").trim();
  const productName = String(body?.productName || "").trim();
  if (!contactId) return { ok:false, error:"contactId required" };
  if (!productName) return { ok:false, error:"productName required" };

  const db = readDb();
  const contact = db.contacts.find(c => c.id === contactId);
  if (!contact) return { ok:false, error:"Contact not found" };
  if (!contact.email) return { ok:false, error:"Contact needs an email address for DocuSign" };

  let concierge;
  try {
    concierge = await conciergePost(env, "/internal/product-selected", {
      contactId,
      contact,
      category:contact.interest || "Manual sale",
      interest:contact.interest || "Manual sale",
      location:contact.location || "",
      leadScore:contact.leadScore || "",
      selectionNumber:1,
      productId:`manual-${Date.now()}`,
      productName,
      source:"buddy-dashboard-manual",
    });
  } catch (error) {
    concierge = { ok:false, error:error.message };
  }

  activity.record({
    type:concierge?.ok ? "docusign.manual-requested" : "docusign.manual-failed",
    entityType:"contact",
    entityId:contactId,
    message:concierge?.ok ? `Manual Buddy agreement requested for ${productName}` : `Manual Buddy agreement failed for ${productName}`,
    metadata:{ productName, source:"buddy-dashboard" },
  });

  return concierge?.ok
    ? { ok:true, data:concierge }
    : { ok:false, error:concierge?.error || "Manual agreement request failed" };
};
