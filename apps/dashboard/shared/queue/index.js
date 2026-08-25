/**
 * Queue abstraction.
 *
 * Provides a uniform interface for enqueuing async jobs.
 * On edge: jobs are enqueued to Cloudflare Queues (or an external provider).
 * On Node: jobs run in-process via direct function calls (existing behavior).
 *
 * This is a seam — domain logic enqueues via this interface, and the
 * runtime wires the correct backend. No domain code changes needed
 * when swapping queue providers.
 */

const logger = require("../logger");
const metrics = require("../metrics");

const JOB_TYPES = {
  CAMPAIGN_SEND: "campaign-send",
  FOLLOWUP_CHECK: "followup-check",
};

// Pluggable queue backend. Set via setBackend().
let backend = null;

// In-memory queue for local/dev (items accumulate until drained)
const localQueue = [];

/**
 * Set the queue backend. Called by the runtime entrypoint.
 * Backend must implement: enqueue(job) => Promise<void>
 */
function setBackend(b) {
  backend = b;
}

/**
 * Enqueue a job for async processing.
 * @param {string} type - one of JOB_TYPES
 * @param {object} payload - job-specific data
 */
async function enqueue(type, payload = {}) {
  const job = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    payload,
    enqueuedAt: new Date().toISOString(),
  };

  logger.info("Job enqueued", { jobId: job.id, type });
  metrics.increment("queue.enqueued");

  if (backend) {
    await backend.enqueue(job);
    return job;
  }

  // Fallback: local in-memory queue
  localQueue.push(job);
  return job;
}

/**
 * Drain the local queue (for Node runtime — runs jobs synchronously).
 * @param {object} runners - map of JOB_TYPE => async function
 */
async function drainLocal(runners) {
  const results = [];
  while (localQueue.length > 0) {
    const job = localQueue.shift();
    const runner = runners[job.type];
    if (runner) {
      try {
        const result = await runner(job.payload);
        results.push({ jobId: job.id, ok: true, result });
        metrics.increment("queue.processed");
      } catch (err) {
        results.push({ jobId: job.id, ok: false, error: err.message });
        metrics.increment("queue.failed");
        logger.error("Job failed", { jobId: job.id, type: job.type, error: err.message });
      }
    } else {
      logger.warn("No runner for job type", { type: job.type });
    }
  }
  return results;
}

/**
 * Get the local queue contents (for inspection).
 */
function pending() {
  return [...localQueue];
}

function clear() {
  localQueue.length = 0;
}

module.exports = { JOB_TYPES, setBackend, enqueue, drainLocal, pending, clear };
