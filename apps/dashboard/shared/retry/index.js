/**
 * Retry policy and DLQ placeholder.
 *
 * Provides exponential-backoff retry for async operations,
 * and a dead-letter queue stub for failed messages.
 */

const DEFAULT_POLICY = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

const dlq = []; // Dead-letter queue (in-memory placeholder)

/**
 * Execute fn with retry policy. Returns { ok, result } or { ok: false, error, attempts }.
 */
async function withRetry(fn, policy = {}) {
  const opts = { ...DEFAULT_POLICY, ...policy };
  let lastError;
  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      const result = await fn();
      return { ok: true, result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt <= opts.maxRetries) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return { ok: false, error: lastError?.message || "Unknown error", attempts: opts.maxRetries + 1 };
}

/**
 * Send a failed item to the DLQ for later inspection/reprocessing.
 */
function sendToDlq(item) {
  dlq.push({
    ...item,
    dlqEnteredAt: new Date().toISOString(),
  });
}

function getDlq() {
  return [...dlq];
}

function clearDlq() {
  dlq.length = 0;
}

module.exports = { withRetry, sendToDlq, getDlq, clearDlq, DEFAULT_POLICY };
