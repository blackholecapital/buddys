const { readDb, mutate } = require("../core/db");
const { normalizeTemplate } = require("../../../shared/schemas");
const activity = require("./activity");

function list() { return readDb().templates; }

function create(input) {
  const template = normalizeTemplate(input);
  mutate((db) => {
    db.templates.unshift(template);
    return db;
  });
  activity.record({ type: "template.created", entityType: "template", entityId: template.id, message: `Created template ${template.name}` });
  return template;
}

function update(id, patch) {
  let updated = null;
  mutate((db) => {
    db.templates = db.templates.map((t) => t.id === id ? (updated = { ...t, ...patch, updatedAt: new Date().toISOString() }) : t);
    return db;
  });
  if (updated) activity.record({ type: "template.updated", entityType: "template", entityId: id, message: `Updated template ${id}` });
  return updated;
}

function remove(id) {
  let found = null;
  mutate((db) => {
    found = db.templates.find((t) => t.id === id) || null;
    db.templates = db.templates.filter((t) => t.id !== id);
    return db;
  });
  if (found) activity.record({ type: "template.deleted", entityType: "template", entityId: id, message: `Deleted template ${id}` });
  return found;
}

function render(template, contact) {
  return (template.body || "")
    .replaceAll("{{firstName}}", contact.firstName || "")
    .replaceAll("{{lastName}}", contact.lastName || "")
    .replaceAll("{{email}}", contact.email || "")
    .replaceAll("{{phone}}", contact.phone || "");
}

module.exports = { list, create, update, remove, render };
