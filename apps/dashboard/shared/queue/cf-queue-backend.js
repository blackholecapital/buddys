/**
 * Cloudflare Queue backend adapter.
 *
 * Implements the queue backend interface expected by shared/queue.
 * Sends jobs to a Cloudflare Queue binding for async processing.
 *
 * The binding is injected from the Worker entrypoint via setBinding().
 */

const logger = require("../logger");

let queueBinding = null;

function setBinding(binding) {
  queueBinding = binding;
}

function getBinding() {
  return queueBinding;
}

/**
 * Enqueue a job to Cloudflare Queues.
 * @param {object} job - { id, type, payload, enqueuedAt }
 */
async function enqueue(job) {
  if (!queueBinding) {
    logger.warn("Queue binding not available, job dropped", { jobId: job.id, type: job.type });
    return;
  }
  await queueBinding.send(job);
  logger.info("Job sent to Cloudflare Queue", { jobId: job.id, type: job.type });
}

module.exports = { setBinding, getBinding, enqueue };
