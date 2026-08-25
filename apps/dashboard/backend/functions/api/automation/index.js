const runtime = require("../../../../shared/runtime");
const queue = require("../../../../shared/queue");
const logger = require("../../../../shared/logger");

// Lazy-load job runner (Node-only)
let followupJob = null;
function getFollowupJob() {
  if (!followupJob) followupJob = require("../../../../worker/jobs/followup-check");
  return followupJob;
}

module.exports = async function handler({ method }) {
  if (method === "POST") {
    if (runtime.isEdge()) {
      const job = await queue.enqueue(queue.JOB_TYPES.FOLLOWUP_CHECK, {});
      logger.info("Followup check dispatched to queue", { jobId: job.id });
      return { ok: true, data: { queued: true, jobId: job.id } };
    }
    return { ok: true, data: await getFollowupJob().run() };
  }
  return { ok: false, error: "Unsupported automation operation" };
};
