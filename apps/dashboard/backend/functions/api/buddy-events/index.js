const buddyEvents = require("../../../layers/domain/buddy-events");

module.exports = async function handler({ method, params, env }) {
  if (method !== "GET") return { ok:false, error:"GET only" };
  if (!env?.BUDDY_DB) return { ok:false, error:"Buddy event database is not configured" };

  const contactId = String(params.contactId || "").trim();
  const limit = Number(params.limit || 1000);
  const conversations = await buddyEvents.conversations(env.BUDDY_DB, { contactId, limit });
  const events = await buddyEvents.list(env.BUDDY_DB, { contactId, limit:Math.min(limit, 500) });
  return { ok:true, data:{ conversations, events } };
};
