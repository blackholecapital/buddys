/**
 * Persistence gateway.
 *
 * All domain modules import readDb/writeDb/mutate from here.
 * This module delegates to the active storage backend.
 *
 * The backend MUST be set before first use:
 *   - Edge: worker-entry sets it to d1-cached-store or memory-store
 *   - Node: server.js / persistence.init() sets it to file-store or sqlite
 *
 * No static require of any storage backend — avoids bundler pulling
 * Node-only code (fs, path, better-sqlite3) into the Worker bundle.
 */

let activeBackend = null;

function setBackend(backend) {
  activeBackend = backend;
}

function getBackend() {
  if (!activeBackend) {
    throw new Error("Persistence backend not initialized. Call db.setBackend() before using readDb/writeDb/mutate.");
  }
  return activeBackend;
}

function readDb() {
  return getBackend().readDb();
}

function writeDb(db) {
  return getBackend().writeDb(db);
}

function mutate(mutator) {
  return getBackend().mutate(mutator);
}

module.exports = { readDb, writeDb, mutate, setBackend };
