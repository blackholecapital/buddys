const { mutate, readDb } = require("../core/db");
const { normalizeActivity } = require("../../../shared/schemas");

function record(activity) {
  const entry = normalizeActivity(activity);
  mutate((db) => {
    db.activities.unshift(entry);
    return db;
  });
  return entry;
}

function list() {
  return readDb().activities;
}

module.exports = { record, list };
