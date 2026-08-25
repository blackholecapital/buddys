/**
 * Health and Readiness endpoints.
 *
 * Edge-safe. Shows runtime, persistence backend, queue status.
 */

const idempotency = require("../../../../shared/idempotency");
const { getDlq } = require("../../../../shared/retry");
const metrics = require("../../../../shared/metrics");
const persistence = require("../../../layers/core/persistence");
const { readDb } = require("../../../layers/core/db");
const env = require("../../../../shared/env");
const runtime = require("../../../../shared/runtime");
const logger = require("../../../../shared/logger");
const queue = require("../../../../shared/queue");
const { LOCK_STALE_MS } = require("../../../layers/domain/campaigns");

const startedAt = new Date().toISOString();

module.exports = async function handler({ method, body, params }) {
  if (method !== "GET") return { ok: false, error: "GET only" };

  const query = params || {};

  if (query.ready) {
    try {
      readDb();
      return { ok: true, data: { ready: true, backend: persistence.getBackend() } };
    } catch (err) {
      logger.error("Readiness check failed", { error: err.message });
      return { ok: false, error: "Not ready: persistence unavailable" };
    }
  }

  const data = {
    status: "healthy",
    version: env.get("APP_VERSION"),
    runtime: runtime.current(),
    startedAt,
    backend: persistence.getBackend(),
    idempotencyKeys: idempotency.size(),
    dlqDepth: getDlq().length,
    queuePending: queue.pending().length,
  };

  const db = readDb();
  const now = Date.now();
  const sendLocked = db.campaigns.filter((c) => c.sendLockedAt);
  const followUpLocked = db.campaigns.filter((c) => c.followUpLockedAt);
  data.lockDiagnostics = {
    staleAfterMs: LOCK_STALE_MS,
    sendLocked: sendLocked.length,
    sendLockedStale: sendLocked.filter((c) => (now - new Date(c.sendLockedAt).getTime()) > LOCK_STALE_MS).length,
    followUpLocked: followUpLocked.length,
    followUpLockedStale: followUpLocked.filter((c) => (now - new Date(c.followUpLockedAt).getTime()) > LOCK_STALE_MS).length,
  };

  if (runtime.isNode()) {
    data.uptime = process.uptime();
    data.node = process.version;
  }

  if (query.metrics) data.metrics = metrics.getAll();
  if (query.dlq) data.dlqItems = getDlq();

  return { ok: true, data };
};
