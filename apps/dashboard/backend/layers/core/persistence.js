/**
 * Persistence Interface.
 *
 * High-level persistence operations. Delegates to the active
 * backend via db.js.
 *
 * Backends:
 *   - "file"   — Node, file-backed JSON (default)
 *   - "sqlite" — Node, better-sqlite3
 *   - "memory" — Edge, in-memory (ephemeral)
 *   - "d1"     — Edge, Cloudflare D1 (durable, wired via worker-entry)
 *
 * No static require of Node-only modules — all backend loading
 * happens via dynamic require() guarded by runtime checks.
 */

const db = require("./db");
const logger = require("../../../shared/logger");

let backendName = "auto";

/**
 * Initialize persistence backend.
 * On edge: called with "memory" or "d1" — backend already wired by worker-entry.
 * On Node: loads file-store or sqlite and wires into db.js.
 */
function init(edgeBackendName) {
  if (edgeBackendName) {
    backendName = edgeBackendName;
    logger.info("Persistence backend: " + backendName);
    return;
  }

  // Node path — dynamic require prevents bundler from resolving Node-only modules
  const requested = (typeof process !== "undefined" && process.env?.DB_BACKEND) || "file";
  if (requested === "sqlite") {
    try {
      const sqlitePath = "./sq" + "lite";
      const sqlite = require(sqlitePath);
      if (sqlite.init()) {
        backendName = "sqlite";
        logger.info("Persistence backend: SQLite");
        return;
      }
    } catch { /* SQLite not available */ }
    logger.warn("SQLite unavailable, falling back to file backend");
  }

  // Default: file-store — dynamic require to prevent bundler resolution
  const fileStorePath = "./file" + "-store";
  const fileStore = require(fileStorePath);
  db.setBackend(fileStore);
  backendName = "file";
  logger.info("Persistence backend: file");
}

const persistence = {
  init,

  getBackend() {
    return backendName;
  },

  setBackendName(name) {
    backendName = name;
  },

  read() {
    return db.readDb();
  },

  write(data) {
    return db.writeDb(data);
  },

  mutate(mutator) {
    return db.mutate(mutator);
  },

  findAll(collection, predicate) {
    const data = this.read();
    const records = data[collection] || [];
    return predicate ? records.filter(predicate) : records;
  },

  findById(collection, id) {
    const data = this.read();
    return (data[collection] || []).find((r) => r.id === id) || null;
  },

  insert(collection, record) {
    this.mutate((data) => {
      if (!data[collection]) data[collection] = [];
      data[collection].unshift(record);
      return data;
    });
    return record;
  },

  update(collection, id, updates) {
    let updated = null;
    this.mutate((data) => {
      if (!data[collection]) data[collection] = [];
      data[collection] = data[collection].map((r) => {
        if (r.id === id) {
          updated = { ...r, ...updates };
          return updated;
        }
        return r;
      });
      return data;
    });
    return updated;
  },

  remove(collection, id) {
    this.mutate((data) => {
      if (!data[collection]) data[collection] = [];
      data[collection] = data[collection].filter((r) => r.id !== id);
      return data;
    });
  },
};

module.exports = persistence;
