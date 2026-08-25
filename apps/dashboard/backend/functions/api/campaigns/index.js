const campaigns = require("../../../layers/domain/campaigns");
const runtime = require("../../../../shared/runtime");
const queue = require("../../../../shared/queue");
const logger = require("../../../../shared/logger");

// Lazy-load job runner (Node-only, avoids bundling in edge)
let sendJob = null;
function getSendJob() {
  if (!sendJob) sendJob = require("../../../../worker/jobs/campaign-send");
  return sendJob;
}

module.exports = async function handler({ method, body, params }) {
  if (method === "GET") return { ok: true, data: campaigns.list() };

  if (method === "POST" && params.action === "run") {
    // Edge: dispatch to queue. Node: run in-process.
    if (runtime.isEdge()) {
      const job = await queue.enqueue(queue.JOB_TYPES.CAMPAIGN_SEND, {});
      logger.info("Campaign send dispatched to queue", { jobId: job.id });
      return { ok: true, data: { queued: true, jobId: job.id } };
    }
    return { ok: true, data: await getSendJob().run() };
  }

  if (method === "POST") return { ok: true, data: campaigns.create(body) };
  return { ok: false, error: "Unsupported campaigns operation" };
};
