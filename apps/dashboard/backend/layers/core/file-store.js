/**
 * File-backed persistence store (Node-only).
 *
 * Original db.js implementation — reads/writes a JSON file.
 * Used as the default backend on Node runtime.
 */

const fs = require("fs");
const path = require("path");
const { normalizeSettings } = require("../../../shared/schemas");

const dataDir = path.join(__dirname, "../../../.data");
const dbFile = path.join(dataDir, "db.json");

const seedDb = {
  contacts: [],
  templates: [],
  campaigns: [],
  messages: [],
  conversations: [],
  activities: [],
  users: [{ id: "user_admin", name: "Pass 4 Admin", role: "admin" }],
  settings: normalizeSettings({}),
  rateLimitEvents: [],
  domainEvents: []
};

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify(seedDb, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

function mutate(mutator) {
  const db = readDb();
  const next = mutator(db) || db;
  writeDb(next);
  return next;
}

module.exports = { readDb, writeDb, mutate };
