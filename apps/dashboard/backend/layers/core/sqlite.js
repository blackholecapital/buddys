/**
 * SQLite persistence backend.
 *
 * Drop-in replacement for db.js that stores data in SQLite.
 * Uses the same collection-of-objects model but with real SQL underneath.
 * Requires better-sqlite3 (or falls back to file-based if unavailable).
 *
 * Tables mirror the JSON collections: contacts, templates, campaigns,
 * messages, conversations, activities, users, settings, rateLimitEvents, domainEvents.
 * Each row stores the full object as a JSON blob + indexed columns for lookups.
 */

const path = require("path");
const fs = require("fs");
const logger = require("../../../shared/logger");

let db = null;
let available = false;

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, "../../../.data/followup.sqlite");

const COLLECTIONS = [
  "contacts", "templates", "campaigns", "messages", "conversations",
  "activities", "users", "settings_store", "rateLimitEvents", "domainEvents",
];

function init() {
  try {
    let Database;
    try {
      Database = require("better-sqlite3");
    } catch {
      logger.info("better-sqlite3 not available, SQLite backend disabled");
      return false;
    }

    const dir = path.dirname(SQLITE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(SQLITE_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Create tables
    for (const col of COLLECTIONS) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${col} (
          id TEXT PRIMARY KEY,
          data JSON NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${col}_created ON ${col}(created_at)`);
    }

    // Special indexes for common lookups
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(json_extract(data, '$.contactId'))`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(json_extract(data, '$.campaignId'))`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(json_extract(data, '$.contactId'))`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(json_extract(data, '$.status'))`);

    available = true;
    logger.info("SQLite backend initialized", { path: SQLITE_PATH });
    return true;
  } catch (err) {
    logger.error("SQLite init failed", { error: err.message });
    return false;
  }
}

function isAvailable() {
  return available;
}

function findAll(collection, predicate) {
  const rows = db.prepare(`SELECT data FROM ${collection} ORDER BY created_at DESC`).all();
  const records = rows.map((r) => JSON.parse(r.data));
  return predicate ? records.filter(predicate) : records;
}

function findById(collection, id) {
  const row = db.prepare(`SELECT data FROM ${collection} WHERE id = ?`).get(id);
  return row ? JSON.parse(row.data) : null;
}

function insert(collection, record) {
  db.prepare(`INSERT OR REPLACE INTO ${collection} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(record.id, JSON.stringify(record), record.createdAt || new Date().toISOString(), new Date().toISOString());
  return record;
}

function update(collection, id, updates) {
  const existing = findById(collection, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  db.prepare(`UPDATE ${collection} SET data = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(updated), new Date().toISOString(), id);
  return updated;
}

function remove(collection, id) {
  db.prepare(`DELETE FROM ${collection} WHERE id = ?`).run(id);
}

function count(collection) {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${collection}`).get();
  return row.cnt;
}

function close() {
  if (db) db.close();
}

module.exports = { init, isAvailable, findAll, findById, insert, update, remove, count, close };
