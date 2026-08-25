const { readDb, mutate } = require("../core/db");
const { normalizeContact } = require("../../../shared/schemas");
const activity = require("./activity");

function list() {
  return readDb().contacts;
}

function create(input) {
  const contact = normalizeContact(input);
  mutate((db) => {
    db.contacts.unshift(contact);
    return db;
  });
  activity.record({ type: "contact.created", entityType: "contact", entityId: contact.id, message: `Created contact ${contact.firstName || contact.email || contact.phone}` });
  return contact;
}

function update(id, patch) {
  let updated = null;
  mutate((db) => {
    db.contacts = db.contacts.map((c) => {
      if (c.id !== id) return c;
      updated = { ...c, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    return db;
  });
  if (updated) activity.record({ type: "contact.updated", entityType: "contact", entityId: id, message: `Updated contact ${id}` });
  return updated;
}

function remove(id) {
  let found = null;
  mutate((db) => {
    found = db.contacts.find((c) => c.id === id) || null;
    db.contacts = db.contacts.filter((c) => c.id !== id);
    return db;
  });
  if (found) activity.record({ type: "contact.deleted", entityType: "contact", entityId: id, message: `Deleted contact ${id}` });
  return found;
}

function importStub(rawText) {
  const lines = String(rawText || "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  const imported = [];
  for (const line of lines) {
    const [firstName, lastName, phone, email] = line.split(",").map((v) => (v || "").trim());
    imported.push(create({ firstName, lastName, phone, email }));
  }
  activity.record({ type: "contact.imported", entityType: "contact-batch", entityId: "batch", message: `Imported ${imported.length} contacts via CSV stub` });
  return { count: imported.length, contacts: imported };
}

module.exports = { list, create, update, remove, importStub };
