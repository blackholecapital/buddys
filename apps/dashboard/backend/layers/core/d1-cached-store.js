/**
 * D1 Cached Store — request-scoped sync wrapper around D1.
 *
 * Domain modules call readDb()/mutate() synchronously. D1 is async.
 * This adapter bridges the gap:
 *
 *   1. At request start: await d1Cached.load(env.DB) — reads full state from D1
 *   2. During request: readDb()/mutate() work on the in-memory cache (sync)
 *   3. At request end: await d1Cached.flush() — writes dirty state back to D1
 *
 * This is the recommended pattern for Cloudflare Workers with existing
 * sync domain code. The cache lives for one request only.
 */

const { normalizeSettings } = require("../../../shared/schemas");
const logger = require("../../../shared/logger");

let d1Binding = null;
let cache = null;
let dirty = false;

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

const TABLES = Object.values(TABLE_MAP);

function setDb(binding) {
  d1Binding = binding;
}

/**
 * Initialize D1 tables if they don't exist.
 */
async function ensureTables() {
  const db = d1Binding;
  const stmts = TABLES.map((t) =>
    db.prepare(`CREATE TABLE IF NOT EXISTS ${t} (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`)
  );
  await db.batch(stmts);

  // Seed admin user if empty
  const userRow = await db.prepare(`SELECT id FROM users WHERE id = 'user_admin'`).first();
  if (!userRow) {
    await db.prepare(`INSERT INTO users (id, data) VALUES (?, ?)`)
      .bind("user_admin", JSON.stringify({ id: "user_admin", name: "D1 Admin", role: "admin" })).run();
  }

  // Seed default settings if empty
  const settingsRow = await db.prepare(`SELECT id FROM settings_kv WHERE id = 'default'`).first();
  if (!settingsRow) {
    const defaults = normalizeSettings({});
    defaults.id = "default";
    await db.prepare(`INSERT INTO settings_kv (id, data) VALUES (?, ?)`)
      .bind("default", JSON.stringify(defaults)).run();
  }
}

/**
 * Load full state from D1 into request-scoped cache.
 * Call this at the start of each request.
 */
async function load(binding) {
  if (binding) d1Binding = binding;
  const db = d1Binding;
  if (!db) throw new Error("D1 binding not set");

  await ensureTables();

  const result = {};
  for (const [logicalName, tableName] of Object.entries(TABLE_MAP)) {
    const rows = await db.prepare(`SELECT data FROM ${tableName} ORDER BY created_at DESC`).all();
    result[logicalName] = (rows.results || []).map((r) => JSON.parse(r.data));
  }

  // Settings is stored as array but exposed as single object
  result.settings = result.settings?.[0] || normalizeSettings({});
  // rateLimitEvents may store timestamp objects
  result.rateLimitEvents = result.rateLimitEvents || [];

  cache = result;
  dirty = false;
}

/**
 * Flush dirty cache back to D1.
 * Call this at the end of each request (in ctx.waitUntil).
 */
async function flush() {
  if (!dirty || !cache || !d1Binding) return;
  const db = d1Binding;
  const stmts = [];

  for (const [logicalName, tableName] of Object.entries(TABLE_MAP)) {
    stmts.push(db.prepare(`DELETE FROM ${tableName}`));

    let records;
    if (logicalName === "settings") {
      const s = cache.settings || normalizeSettings({});
      s.id = s.id || "default";
      records = [s];
    } else {
      records = cache[logicalName];
    }
    if (!Array.isArray(records)) continue;

    for (const record of records) {
      const id = record.id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      stmts.push(
        db.prepare(`INSERT INTO ${tableName} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`)
          .bind(id, JSON.stringify(record), record.createdAt || new Date().toISOString(), new Date().toISOString())
      );
    }
  }

  await db.batch(stmts);
  dirty = false;
  logger.info("D1 cache flushed");
}

// --- Sync interface for domain code ---

function readDb() {
  if (!cache) {
    // Fallback: return empty seed (should not happen if load() was called)
    logger.warn("D1 cache not loaded, returning empty seed");
    return {
      contacts: [], templates: [], campaigns: [], messages: [],
      conversations: [], activities: [],
      users: [{ id: "user_admin", name: "D1 Admin", role: "admin" }],
      settings: normalizeSettings({}),
      rateLimitEvents: [], domainEvents: [],
    };
  }
  // Return a deep copy so callers don't corrupt the cache
  return JSON.parse(JSON.stringify(cache));
}

function writeDb(data) {
  cache = data;
  dirty = true;
}

function mutate(mutator) {
  if (!cache) readDb(); // ensure cache exists
  const next = mutator(cache) || cache;
  cache = next;
  dirty = true;
  return next;
}

function isDirty() {
  return dirty;
}

function reset() {
  cache = null;
  dirty = false;
}

module.exports = { setDb, load, flush, readDb, writeDb, mutate, isDirty, reset };
