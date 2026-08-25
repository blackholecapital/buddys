/**
 * Cloudflare Worker entrypoint.
 *
 * Handles:
 *   - fetch: API requests, webhook ingestion, CORS
 *   - queue: Background job consumption (campaign-send, followup-check)
 *
 * Persistence: D1 if env.DB is bound, otherwise in-memory (dev).
 * Queues: env.FOLLOWUP_QUEUE for producing; queue() handler for consuming.
 *
 * Does NOT handle:
 *   - Static file serving (Cloudflare Pages / R2)
 */

const runtime = require("./shared/runtime");
runtime.override("edge");

const { routeRequest } = require("./backend/edge-router");
const env = require("./shared/env");
const logger = require("./shared/logger");
const metrics = require("./shared/metrics");
const permissions = require("./shared/permissions");
const db = require("./backend/layers/core/db");
const d1Cached = require("./backend/layers/core/d1-cached-store");
const queue = require("./shared/queue");
const cfQueueBackend = require("./shared/queue/cf-queue-backend");

// Domain imports (after db is wired)
const contacts = require("./backend/layers/domain/contacts");
const templates = require("./backend/layers/domain/templates");
const { readDb } = require("./backend/layers/core/db");

// Worker job runners (for queue consumer)
const campaignSendJob = require("./worker/jobs/campaign-send");
const followupCheckJob = require("./worker/jobs/followup-check");

let tablesInitialized = false;

/**
 * Wire persistence: D1 if available, else memory-store.
 */
async function initPersistence(workerEnv) {
  if (workerEnv.DB) {
    d1Cached.setDb(workerEnv.DB);
    await d1Cached.load(workerEnv.DB);
    db.setBackend(d1Cached);
    if (!tablesInitialized) {
      tablesInitialized = true;
      logger.info("Persistence: D1");
    }
  }
  // else: db.js defaults to memory-store (already set by runtime.override("edge"))
}

/**
 * Wire queue producer if FOLLOWUP_QUEUE binding exists.
 */
function initQueue(workerEnv) {
  if (workerEnv.FOLLOWUP_QUEUE) {
    cfQueueBackend.setBinding(workerEnv.FOLLOWUP_QUEUE);
    queue.setBackend(cfQueueBackend);
    logger.info("Queue: Cloudflare Queues");
  }
}

function ensureSeed() {
  const data = readDb();
  if (!data.contacts.length) {
    contacts.create({ firstName: "Alex", lastName: "Buyer", phone: "+15550000001", email: "alex@example.com", channelPreference: "sms" });
  }
  if (!data.templates.length) {
    templates.create({ name: "Initial check-in", channel: "sms", body: "Hi {{firstName}}, checking in on your request." });
    templates.create({ name: "Follow-up nudge", channel: "sms", body: "Hi {{firstName}}, following up in case you missed my last note." });
  }
}

module.exports = {
  /**
   * HTTP fetch handler — API + webhook surface.
   */
  async fetch(request, workerEnv, ctx) {
    env.setBindings(workerEnv);
    await initPersistence(workerEnv);
    initQueue(workerEnv);
    ensureSeed();

    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Correlation-Id",
        },
      });
    }

    if (!pathname.startsWith("/api/") && !pathname.startsWith("/webhooks/")) {
      return new Response("Not found", { status: 404 });
    }

    const correlationId = request.headers.get("x-correlation-id") || logger.generateCorrelationId();
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const response = await logger.withContext({ correlationId, requestId }, async () => {
      metrics.increment("http.requests");
      const startTime = Date.now();
      const headersObj = {};
      request.headers.forEach((v, k) => { headersObj[k] = v; });

      logger.info("Request", { method, path: pathname, runtime: "edge" });

      const authResult = permissions.enforce(method, pathname, headersObj);
      if (!authResult.allowed) {
        metrics.increment("http.forbidden");
        return jsonResponse(403, { ok: false, error: authResult.error }, correlationId, requestId);
      }

      const queryObj = {};
      searchParams.forEach((v, k) => { queryObj[k] = v; });

      const match = routeRequest(pathname, method, queryObj, headersObj);
      if (!match) {
        return jsonResponse(404, { ok: false, error: "Route not found" }, correlationId, requestId);
      }

      try {
        let body = {};
        if (method !== "GET" && method !== "HEAD") {
          try { body = await request.json(); } catch { body = {}; }
        }

        const result = await match.fn({ method, body, params: match.params, user: authResult.user });
        const status = result.ok ? 200 : 400;
        const duration = Date.now() - startTime;
        logger.info("Response", { method, path: pathname, status, duration });
        metrics.increment("http.responses." + status);
        return jsonResponse(status, result, correlationId, requestId);
      } catch (err) {
        metrics.increment("http.errors");
        logger.error("Handler error", { method, path: pathname, error: err.message });
        return jsonResponse(500, { ok: false, error: "Internal server error" }, correlationId, requestId);
      }
    });

    // Flush D1 cache after response is built (non-blocking)
    if (d1Cached.isDirty() && workerEnv.DB) {
      ctx.waitUntil(d1Cached.flush());
    }

    return response;
  },

  /**
   * Queue consumer handler — processes background jobs.
   * Receives messages from FOLLOWUP_QUEUE.
   */
  async queue(batch, workerEnv, ctx) {
    env.setBindings(workerEnv);
    await initPersistence(workerEnv);

    logger.info("Queue batch received", { size: batch.messages.length });

    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        logger.info("Processing job", { jobId: job.id, type: job.type });

        if (job.type === "campaign-send") {
          await campaignSendJob.run();
        } else if (job.type === "followup-check") {
          await followupCheckJob.run();
        } else {
          logger.warn("Unknown job type", { type: job.type });
        }

        msg.ack();
        metrics.increment("queue.processed");
        logger.info("Job completed", { jobId: job.id, type: job.type });
      } catch (err) {
        msg.retry();
        metrics.increment("queue.failed");
        logger.error("Job failed, retrying", { jobId: job.id, type: job.type, error: err.message });
      }
    }

    // Flush D1 after queue processing
    if (d1Cached.isDirty() && workerEnv.DB) {
      await d1Cached.flush();
    }
  },
};

function jsonResponse(status, payload, correlationId, requestId) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Correlation-Id": correlationId || "",
      "X-Request-Id": requestId || "",
    },
  });
}
