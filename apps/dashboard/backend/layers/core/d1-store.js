/**
 * D1 persistence adapter for Cloudflare Workers.
 *
 * Implements the same readDb/writeDb/mutate interface as file-store and
 * memory-store, backed by Cloudflare D1 (SQLite at edge).
 *
 * Each collection is a table. Rows store the full object as a JSON column
 * plus an `id` primary key. This mirrors the SQLite adapter pattern
 * but uses D1's prepared-statement API.
 *
 * The D1 binding is injected via setDb() from the Worker entrypoint.
 */

const { normalizeSettings } = require("../../../shared/schemas");

let d1 = null;

const COLLECTIONS = [
  "contacts", "templates", "campaigns", "messages", "conversations",
  "activities", "users", "settings_kv", "rate_limit_events", "domain_events",
];

// Map logical collection names to table names
const TABLE_MAP = {
  contacts: "contacts",
  templates: "templates",
  campaigns: "campaigns",
  messages: "messages",
  conversations: "conversations",
  activities: "activities",
  users: "users",
  settings: "settings_kv",
  rateLimitEvents: "rate_limit_events",
  domainEvents: "domain_events",
};

function setDb(binding) {
  d1 = binding;
}

function getDb() {
  if (!d1) throw new Error("D1 binding not set. Call d1Store.setDb(env.DB) in worker-entry.");
  return d1;
}

function table(collection) {
  return TABLE_MAP[collection] || collection;
}

/**
 * Initialize D1 tables. Call once on first request.
 */
async function init() {
  const db = getDb();
  const stmts = COLLECTIONS.map((col) =>
    db.prepare(`CREATE TABLE IF NOT EXISTS ${col} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`)
  );
  await db.batch(stmts);

  // Indexes for common queries
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(json_extract(data, '$.contactId'))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(json_extract(data, '$.campaignId'))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(json_extract(data, '$.status'))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(json_extract(data, '$.contactId'))`),
  ]);

  // Ensure default settings row exists
  const settingsRow = await db.prepare(`SELECT id FROM settings_kv WHERE id = 'default'`).first();
  if (!settingsRow) {
    const defaults = normalizeSettings({});
    await db.prepare(`INSERT INTO settings_kv (id, data) VALUES (?, ?)`)
      .bind("default", JSON.stringify(defaults)).run();
  }

  // Ensure default admin user exists
  const userRow = await db.prepare(`SELECT id FROM users WHERE id = 'user_admin'`).first();
  if (!userRow) {
    await db.prepare(`INSERT INTO users (id, data) VALUES (?, ?)`)
      .bind("user_admin", JSON.stringify({ id: "user_admin", name: "D1 Admin", role: "admin" })).run();
  }
}

/**
 * Read the full "database" as a single object (same shape as file-store).
 * Used by domain modules that call readDb().
 */
async function readDb() {
  const db = getDb();
  const result = {};

  for (const [logicalName, tableName] of Object.entries(TABLE_MAP)) {
    const rows = await db.prepare(`SELECT data FROM ${tableName} ORDER BY created_at DESC`).all();
    result[logicalName] = (rows.results || []).map((r) => JSON.parse(r.data));
  }

  // Settings is a single object, not an array
  result.settings = result.settings?.[0] || normalizeSettings({});
  // rateLimitEvents stores timestamps as numbers
  result.rateLimitEvents = result.rateLimitEvents || [];

  return result;
}

/**
 * Write the full database object (replaces all data). Used sparingly.
 */
async function writeDb(data) {
  const db = getDb();
  const stmts = [];

  for (const [logicalName, tableName] of Object.entries(TABLE_MAP)) {
    stmts.push(db.prepare(`DELETE FROM ${tableName}`));

    let records = data[logicalName];
    if (logicalName === "settings") {
      records = [data.settings || normalizeSettings({})];
      records[0].id = records[0].id || "default";
    }
    if (!Array.isArray(records)) continue;

    for (const record of records) {
      const id = record.id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      stmts.push(
        db.prepare(`INSERT INTO ${tableName} (id, data) VALUES (?, ?)`)
          .bind(id, JSON.stringify(record))
      );
    }
  }

  await db.batch(stmts);
}

/**
 * Read-modify-write. Reads full DB, applies mutator, writes back.
 * For D1, this is not transactional — acceptable for single-writer patterns.
 */
async function mutate(mutator) {
  const data = await readDb();
  const next = mutator(data) || data;
  await writeDb(next);
  return next;
}

// --- Collection-level operations (faster than full read/write) ---

async function findAll(collection, predicate) {
  const db = getDb();
  const rows = await db.prepare(`SELECT data FROM ${table(collection)} ORDER BY created_at DESC`).all();
  const records = (rows.results || []).map((r) => JSON.parse(r.data));
  return predicate ? records.filter(predicate) : records;
}

async function findById(collection, id) {
  const db = getDb();
  const row = await db.prepare(`SELECT data FROM ${table(collection)} WHERE id = ?`).bind(id).first();
  return row ? JSON.parse(row.data) : null;
}

async function insert(collection, record) {
  const db = getDb();
  const id = record.id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await db.prepare(`INSERT OR REPLACE INTO ${table(collection)} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .bind(id, JSON.stringify(record), record.createdAt || new Date().toISOString(), new Date().toISOString()).run();
  return record;
}

async function update(collection, id, updates) {
  const existing = await findById(collection, id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  const db = getDb();
  await db.prepare(`UPDATE ${table(collection)} SET data = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(updated), new Date().toISOString(), id).run();
  return updated;
}

async function remove(collection, id) {
  const db = getDb();
  await db.prepare(`DELETE FROM ${table(collection)} WHERE id = ?`).bind(id).run();
}

module.exports = { setDb, init, readDb, writeDb, mutate, findAll, findById, insert, update, remove };
