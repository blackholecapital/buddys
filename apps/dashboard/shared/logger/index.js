/**
 * Structured Logger with Correlation IDs.
 *
 * Edge-safe: no static import of node:async_hooks.
 * Node: dynamically loads AsyncLocalStorage at first use.
 * Workers: uses simple variable-based context (single-request-per-isolate).
 */

const runtime = require("../runtime");

let contextStore = null;
let alsLoaded = false;

function getAsyncLocalStorage() {
  if (contextStore) return contextStore;
  if (alsLoaded) return null; // Already tried, not available
  alsLoaded = true;
  if (runtime.isNode()) {
    try {
      // Dynamic require string prevents bundler from resolving this
      const moduleName = "node:" + "async_hooks";
      const mod = require(moduleName);
      contextStore = new mod.AsyncLocalStorage();
    } catch {
      contextStore = null;
    }
  }
  return contextStore;
}

// Edge fallback: single-variable context (Workers are single-request-per-isolate)
let edgeContext = {};

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function getEnvVar(key, fallback) {
  if (typeof process !== "undefined" && process.env) return process.env[key] || fallback;
  return fallback;
}

const currentLevel = LOG_LEVELS[getEnvVar("LOG_LEVEL", "info")] || LOG_LEVELS.info;
const isJson = getEnvVar("LOG_FORMAT", "text") === "json" || getEnvVar("NODE_ENV", "") === "production";

function getContext() {
  const als = getAsyncLocalStorage();
  if (als) return als.getStore() || {};
  return edgeContext;
}

function withContext(ctx, fn) {
  const als = getAsyncLocalStorage();
  if (als) {
    const parent = als.getStore() || {};
    return als.run({ ...parent, ...ctx }, fn);
  }
  const prev = edgeContext;
  edgeContext = { ...prev, ...ctx };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.finally(() => { edgeContext = prev; });
    }
    edgeContext = prev;
    return result;
  } catch (e) {
    edgeContext = prev;
    throw e;
  }
}

function generateCorrelationId() {
  return `cor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatLine(level, message, data) {
  const ctx = getContext();
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    correlationId: ctx.correlationId || undefined,
    requestId: ctx.requestId || undefined,
    ...data,
  };
  if (isJson) return JSON.stringify(entry);
  const prefix = ctx.correlationId ? `[${ctx.correlationId}] ` : "";
  const extras = data && Object.keys(data).length ? " " + JSON.stringify(data) : "";
  return `${entry.ts} ${level.toUpperCase().padEnd(5)} ${prefix}${message}${extras}`;
}

function log(level, message, data = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const line = formatLine(level, message, data);
  if (level === "error" || level === "fatal") {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  debug: (msg, data) => log("debug", msg, data),
  info: (msg, data) => log("info", msg, data),
  warn: (msg, data) => log("warn", msg, data),
  error: (msg, data) => log("error", msg, data),
  fatal: (msg, data) => log("fatal", msg, data),
  withContext,
  getContext,
  generateCorrelationId,
  get contextStore() { return getAsyncLocalStorage(); },
};
