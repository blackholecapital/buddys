const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { readDb } = require("../../../layers/core/db");
const { conciergePost } = require("../../../../shared/services/concierge");

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const contactId = String(body?.contactId || "").trim();
  if (!contactId) return { ok:false, error:"contactId required" };

  const db = readDb();
  const contact = db.contacts.find((c) => c.id === contactId);
  if (!contact) return { ok:false, error:"Contact not found" };
  if (!contact.phone) return { ok:false, error:"Contact has no phone number" };
  if (contact.optedOut) return { ok:false, error:"Contact is opted out" };

  const updatedContact = contacts.update(contact.id, {
    stage: "Engaged",
    callStatus: "Call requested",
  }) || contact;

  activity.record({
    type:"call.requested",
    entityType:"contact",
    entityId:contact.id,
    message:`Manual voice call requested for ${updatedContact.firstName || updatedContact.phone}`,
    metadata:{
      source:"buddy-dashboard",
      leadScore:updatedContact.leadScore,
      interest:updatedContact.interest,
      location:updatedContact.location,
    }
  });

  let concierge;
  try {
    concierge = await conciergePost(env, "/internal/calls", {
      contactId:updatedContact.id,
      contact:updatedContact,
      context:{
        firstName:updatedContact.firstName,
        lastName:updatedContact.lastName,
        phone:updatedContact.phone,
        email:updatedContact.email,
        interest:updatedContact.interest,
        location:updatedContact.location,
        comments:updatedContact.comments,
        leadScore:updatedContact.leadScore,
        preferredContactTime:updatedContact.preferredContactTime,
        source:updatedContact.source,
      },
      trigger:{ type:"operator-dashboard" }
    });
  } catch(err) {
    concierge={ ok:false, error:err.message };
  }

  return {
    ok:Boolean(concierge?.ok),
    data:{ contact:updatedContact, concierge },
    error:concierge?.ok ? undefined : (concierge?.error || concierge?.result?.error || "Voice call request failed")
  };
};
