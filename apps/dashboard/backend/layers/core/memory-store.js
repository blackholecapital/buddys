/**
 * In-memory persistence adapter for edge runtime.
 *
 * Provides the same readDb/writeDb/mutate interface as db.js
 * but stores everything in memory. Suitable for Cloudflare Workers
 * where filesystem access is unavailable.
 *
 * Data is ephemeral per isolate — for durable edge storage,
 * swap this for a D1, KV, or Durable Objects adapter.
 */

const { normalizeSettings } = require("../../../shared/schemas");

let store = null;

function seedDb() {
  return {
    contacts: [],
    templates: [],
    campaigns: [],
    messages: [],
    conversations: [],
    activities: [],
    users: [{ id: "user_admin", name: "Edge Admin", role: "admin" }],
    settings: normalizeSettings({}),
    rateLimitEvents: [],
    domainEvents: [],
  };
}

function ensureStore() {
  if (!store) store = seedDb();
}

function readDb() {
  ensureStore();
  // Return a deep copy to prevent mutation of the store directly
  return JSON.parse(JSON.stringify(store));
}

function writeDb(db) {
  store = db;
}

function mutate(mutator) {
  ensureStore();
  const next = mutator(store) || store;
  store = next;
  return next;
}

function reset() {
  store = seedDb();
}

module.exports = { readDb, writeDb, mutate, reset };
