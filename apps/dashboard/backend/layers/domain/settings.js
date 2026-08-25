const { readDb, mutate } = require("../core/db");
const { normalizeSettings } = require("../../../shared/schemas");
const activity = require("./activity");

function get() {
  return readDb().settings;
}

function update(patch) {
  let settings;
  mutate((db) => {
    settings = normalizeSettings({ ...db.settings, ...patch, rateLimits: { ...db.settings.rateLimits, ...(patch.rateLimits || {}) }, compliance: { ...db.settings.compliance, ...(patch.compliance || {}) }, providers: { ...db.settings.providers, ...(patch.providers || {}) } });
    db.settings = settings;
    return db;
  });
  activity.record({ type: "settings.updated", entityType: "settings", entityId: "default", message: "Updated settings" });
  return settings;
}

module.exports = { get, update };
