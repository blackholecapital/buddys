/**
 * Idempotency layer.
 *
 * Provides dedupe keys for jobs, sends, and inbound webhooks.
 * Backed by in-memory store now; swap to Redis/DB via the persistence interface later.
 */

const processedKeys = new Map(); // key -> { result, processedAt, expiresAt }

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if an operation with this key was already processed.
 * Returns { duplicate: true, result } if already processed.
 * Returns { duplicate: false } if new.
 */
function check(idempotencyKey) {
  if (!idempotencyKey) return { duplicate: false };
  const entry = processedKeys.get(idempotencyKey);
  if (!entry) return { duplicate: false };
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    processedKeys.delete(idempotencyKey);
    return { duplicate: false };
  }
  return { duplicate: true, result: entry.result };
}

/**
 * Mark an operation as processed. Store the result for replay.
 */
function mark(idempotencyKey, result, ttlMs = DEFAULT_TTL_MS) {
  if (!idempotencyKey) return;
  processedKeys.set(idempotencyKey, {
    result,
    processedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Generate a dedupe key from component parts.
 */
function makeKey(...parts) {
  return parts.filter(Boolean).join("::");
}

/**
 * Wrap an async operation with idempotency.
 * If the key was seen before, return the cached result.
 * Otherwise run fn() and cache.
 */
async function withIdempotency(key, fn) {
  const existing = check(key);
  if (existing.duplicate) return existing.result;
  const result = await fn();
  mark(key, result);
  return result;
}

function clear() {
  processedKeys.clear();
}

function size() {
  return processedKeys.size;
}

module.exports = { check, mark, makeKey, withIdempotency, clear, size };
