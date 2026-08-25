/**
 * Cloudflare Module Worker entrypoint.
 * API/webhook surface + queue consumers.
 */

import runtime from "./shared/runtime/index.js";
runtime.override("edge");

import { routeRequest } from "./backend/edge-router.js";
import env from "./shared/env/index.js";
import logger from "./shared/logger/index.js";
import metrics from "./shared/metrics/index.js";
import permissions from "./shared/permissions/index.js";
import db from "./backend/layers/core/db.js";
import d1Cached from "./backend/layers/core/d1-cached-store.js";
import queue from "./shared/queue/index.js";
import cfQueueBackend from "./shared/queue/cf-queue-backend.js";
import memoryStore from "./backend/layers/core/memory-store.js";
import contacts from "./backend/layers/domain/contacts.js";
import templates from "./backend/layers/domain/templates.js";
import buddyEvents from "./backend/layers/domain/buddy-events.js";
import campaignSendJob from "./worker/jobs/campaign-send/index.js";
import followupCheckJob from "./worker/jobs/followup-check/index.js";

let memoryBackendSet = false;

async function initPersistence(workerEnv) {
  if (workerEnv.DB) {
    d1Cached.setDb(workerEnv.DB);
    await d1Cached.load(workerEnv.DB);
    db.setBackend(d1Cached);
  } else if (!memoryBackendSet) {
    db.setBackend(memoryStore);
    memoryBackendSet = true;
  }
}

function initQueue(workerEnv) {
  if (workerEnv.FOLLOWUP_QUEUE) {
    cfQueueBackend.setBinding(workerEnv.FOLLOWUP_QUEUE);
    queue.setBackend(cfQueueBackend);
  }
}

function ensureSeed() {
  const data = db.readDb();
  if (!data.contacts.length) contacts.create({ firstName:"Alex", lastName:"Buyer", phone:"+15550000001", email:"alex@example.com", channelPreference:"sms" });
  if (!data.templates.length) {
    templates.create({ name:"Initial check-in", channel:"sms", body:"Hi {{firstName}}, checking in on your request." });
    templates.create({ name:"Follow-up nudge", channel:"sms", body:"Hi {{firstName}}, following up in case you missed my last note." });
  }
}

function jsonResponse(status, payload, correlationId, requestId) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers:{
      "Content-Type":"application/json",
      "Access-Control-Allow-Origin":"*",
      "X-Correlation-Id":correlationId || "",
      "X-Request-Id":requestId || "",
    },
  });
}

export default {
  async fetch(request, workerEnv, ctx) {
    env.setBindings(workerEnv);
    await initPersistence(workerEnv);
    initQueue(workerEnv);

    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status:204, headers:{
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type,Authorization,X-Correlation-Id",
      }});
    }

    if (!pathname.startsWith("/api/") && !pathname.startsWith("/webhooks/")) return workerEnv.ASSETS.fetch(request);

    const correlationId = request.headers.get("x-correlation-id") || logger.generateCorrelationId();
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;

    const response = await logger.withContext({ correlationId, requestId }, async () => {
      metrics.increment("http.requests");
      const headersObj = {};
      request.headers.forEach((v,k)=>{ headersObj[k]=v; });
      const authResult = permissions.enforce(method, pathname, headersObj);
      if (!authResult.allowed) return jsonResponse(403, { ok:false, error:authResult.error }, correlationId, requestId);

      const queryObj = {};
      searchParams.forEach((v,k)=>{ queryObj[k]=v; });
      const match = routeRequest(pathname, method, queryObj, headersObj);
      if (!match) return jsonResponse(404, { ok:false, error:"Route not found" }, correlationId, requestId);

      try {
        let body = {};
        if (method !== "GET" && method !== "HEAD") {
          try { body = await request.json(); } catch { body = {}; }
        }
        const result = await match.fn({ method, body, params:match.params, user:authResult.user, env:workerEnv });
        const status = result.ok ? 200 : 400;
        metrics.increment("http.responses." + status);
        return jsonResponse(status, result, correlationId, requestId);
      } catch (err) {
        metrics.increment("http.errors");
        logger.error("Handler error", { method, path:pathname, error:err.message });
        return jsonResponse(500, { ok:false, error:"Internal server error" }, correlationId, requestId);
      }
    });

    if (d1Cached.isDirty() && workerEnv.DB) ctx.waitUntil(d1Cached.flush());
    return response;
  },

  async queue(batch, workerEnv, ctx) {
    env.setBindings(workerEnv);
    await initPersistence(workerEnv);

    for (const msg of batch.messages) {
      const job = msg.body || {};
      try {
        if (job.type === "campaign-send") {
          await campaignSendJob.run();
        } else if (job.type === "followup-check") {
          await followupCheckJob.run();
        } else if (workerEnv.BUDDY_DB && job.type) {
          await buddyEvents.record(workerEnv.BUDDY_DB, job);
        } else {
          logger.warn("Unknown queue message", { type:job.type || "unknown" });
        }
        msg.ack();
        metrics.increment("queue.processed");
      } catch (err) {
        msg.retry();
        metrics.increment("queue.failed");
        logger.error("Queue message failed", { type:job.type || "unknown", error:err.message });
      }
    }

    if (d1Cached.isDirty() && workerEnv.DB) await d1Cached.flush();
  },
};
