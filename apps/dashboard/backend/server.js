/**
 * Node.js server entrypoint.
 *
 * Handles HTTP serving, static files, graceful shutdown.
 * This is the NON-EDGE execution target. Background jobs
 * (campaign-send, followup-check, reconciliation) run here.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// Force Node runtime
const runtime = require("../shared/runtime");
runtime.override("node");

const { route } = require("./router");
const { json, readJson } = require("./layers/core/http");
const { readDb } = require("./layers/core/db");
const persistence = require("./layers/core/persistence");
const contacts = require("./layers/domain/contacts");
const templates = require("./layers/domain/templates");
const metrics = require("../shared/metrics");
const logger = require("../shared/logger");
const env = require("../shared/env");
const permissions = require("../shared/permissions");

const frontendDir = path.join(__dirname, "../frontend");
let shuttingDown = false;
const startedAt = new Date().toISOString();

function ensureSeed() {
  const db = readDb();
  if (!db.contacts.length) {
    contacts.create({ firstName: "Alex", lastName: "Buyer", phone: "+15550000001", email: "alex@example.com", channelPreference: "sms" });
  }
  if (!db.templates.length) {
    templates.create({ name: "Initial check-in", channel: "sms", body: "Hi {{firstName}}, checking in on your request." });
    templates.create({ name: "Follow-up nudge", channel: "sms", body: "Hi {{firstName}}, following up in case you missed my last note." });
  }
}

function serveStatic(req, res) {
  let pathname = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(frontendDir, pathname);
  if (!filePath.startsWith(frontendDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "text/html";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

async function start(port) {
  const envResult = env.validate();
  if (!envResult.valid) {
    for (const err of envResult.errors) logger.error("Env validation error", { error: err });
    if (env.isProduction()) {
      logger.fatal("Cannot start in production with invalid env");
      process.exit(1);
    }
  }

  port = port || env.get("PORT");
  logger.info("Starting Node server", { port, env: env.get("NODE_ENV"), config: env.safeConfig() });

  persistence.init();
  ensureSeed();

  const server = http.createServer(async (req, res) => {
    if (shuttingDown) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Server is shutting down" }));
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Correlation-Id"
      });
      return res.end();
    }

    if (req.url.startsWith("/api/") || req.url.startsWith("/webhooks/")) {
      const correlationId = req.headers["x-correlation-id"] || logger.generateCorrelationId();
      const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      return logger.withContext({ correlationId, requestId }, async () => {
        metrics.increment("http.requests");
        const startTime = Date.now();
        const parsed = url.parse(req.url, true);

        logger.info("Request", { method: req.method, path: parsed.pathname });

        const authResult = permissions.enforce(req.method, parsed.pathname, req.headers || {});
        if (!authResult.allowed) {
          metrics.increment("http.forbidden");
          return json(res, 403, { ok: false, error: authResult.error });
        }

        const match = route(req);
        if (!match) {
          return json(res, 404, { ok: false, error: "Route not found" });
        }

        try {
          const body = await readJson(req);
          if (body && body.__invalid) {
            metrics.increment("http.bad_request");
            return json(res, 400, { ok: false, error: body.__invalid });
          }
          const result = await match.fn({ method: req.method, body, params: match.params, user: authResult.user });
          const status = result.ok ? 200 : 400;
          res.setHeader("X-Correlation-Id", correlationId);
          res.setHeader("X-Request-Id", requestId);
          const duration = Date.now() - startTime;
          logger.info("Response", { method: req.method, path: parsed.pathname, status, duration });
          metrics.increment("http.responses." + status);
          return json(res, status, result);
        } catch (err) {
          metrics.increment("http.errors");
          const duration = Date.now() - startTime;
          logger.error("Handler error", { method: req.method, path: parsed.pathname, error: err.message, stack: err.stack, duration });
          return json(res, 500, { ok: false, error: "Internal server error" });
        }
      });
    }
    return serveStatic(req, res);
  });

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Graceful shutdown initiated", { signal });
    server.close(() => {
      logger.info("Server closed, exiting");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  return new Promise((resolve) => {
    server.listen(port, () => {
      logger.info("Server listening", { port, startedAt, backend: persistence.getBackend(), runtime: "node" });
      resolve(server);
    });
  });
}

module.exports = { start };

if (require.main === module) {
  start().then(() => {});
}
