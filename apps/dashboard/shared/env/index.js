/**
 * Environment validation and secrets handling.
 *
 * Edge-safe: reads from injected env bindings on Workers,
 * falls back to process.env on Node.
 */

const runtime = require("../runtime");

const SCHEMA = {
  PORT: { type: "number", default: 3000 },
  NODE_ENV: { type: "string", default: "development", allowed: ["development", "production", "test"] },
  APP_VERSION: { type: "string", default: "pass-6-dev" },
  LOG_LEVEL: { type: "string", default: "info", allowed: ["debug", "info", "warn", "error"] },
  LOG_FORMAT: { type: "string", default: "text", allowed: ["text", "json"] },
  TWILIO_ACCOUNT_SID: { type: "string", default: "", secret: true },
  TWILIO_AUTH_TOKEN: { type: "string", default: "", secret: true },
  TWILIO_FROM_NUMBER: { type: "string", default: "" },
  SENDGRID_API_KEY: { type: "string", default: "", secret: true },
  SENDGRID_FROM_EMAIL: { type: "string", default: "" },
  DB_BACKEND: { type: "string", default: "file", allowed: ["file", "sqlite", "memory", "d1"] },
  DB_PATH: { type: "string", default: ".data/db.json" },
  SQLITE_PATH: { type: "string", default: ".data/followup.sqlite" },
  RUNTIME_TARGET: { type: "string", default: "node", allowed: ["node", "edge"] },
};

const SECRET_KEYS = Object.entries(SCHEMA)
  .filter(([, v]) => v.secret)
  .map(([k]) => k);

let validated = null;
let envBindings = null; // Set by Worker entrypoint

/**
 * Inject env bindings from Worker handler (called before validate).
 */
function setBindings(bindings) {
  envBindings = bindings;
  validated = null; // Re-validate on next get()
}

function readVar(key) {
  // 1. Worker env bindings (set via setBindings)
  if (envBindings && envBindings[key] !== undefined) return String(envBindings[key]);
  // 2. Node process.env
  if (typeof process !== "undefined" && process.env && process.env[key] !== undefined) return process.env[key];
  return undefined;
}

function validate() {
  const errors = [];
  const config = {};

  for (const [key, spec] of Object.entries(SCHEMA)) {
    let value = readVar(key);

    if (value === undefined || value === "") {
      if (spec.required) {
        errors.push(`Missing required env var: ${key}`);
        continue;
      }
      value = String(spec.default);
    }

    if (spec.allowed && !spec.allowed.includes(value)) {
      errors.push(`Invalid value for ${key}: "${value}" (allowed: ${spec.allowed.join(", ")})`);
      continue;
    }

    if (spec.type === "number") {
      const num = Number(value);
      if (isNaN(num)) {
        errors.push(`${key} must be a number, got "${value}"`);
        continue;
      }
      config[key] = num;
    } else {
      config[key] = value;
    }
  }

  if (errors.length > 0) return { valid: false, errors, config: null };
  validated = config;
  return { valid: true, errors: [], config };
}

function get(key) {
  if (!validated) validate();
  return validated?.[key] ?? SCHEMA[key]?.default;
}

function isProduction() { return get("NODE_ENV") === "production"; }
function isTest() { return get("NODE_ENV") === "test"; }

function safeConfig() {
  if (!validated) validate();
  const safe = { ...(validated || {}) };
  for (const key of SECRET_KEYS) {
    if (safe[key]) safe[key] = "***REDACTED***";
  }
  return safe;
}

module.exports = { validate, get, isProduction, isTest, safeConfig, setBindings, SCHEMA, SECRET_KEYS };
