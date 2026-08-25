const contacts = require("./contacts");
const activity = require("./activity");
const { readDb } = require("../core/db");

function optOut({ contactId, reason = "manual opt-out" }) {
  const contact = contacts.update(contactId, { optedOut: true });
  if (!contact) return null;
  activity.record({ type: "contact.opted_out", entityType: "contact", entityId: contactId, message: `Opted out ${contactId}: ${reason}` });
  return contact;
}

function detectStopWord(body = "") {
  const db = readDb();
  const stopWords = db.settings?.compliance?.stopWords || ["STOP"];
  const normalized = String(body).trim().toUpperCase();
  return stopWords.includes(normalized);
}

module.exports = { optOut, detectStopWord };
