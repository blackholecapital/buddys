const http = require("http");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "../.data/db.json");
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "warn";

const { start } = require("../backend/server");

let server;
let port;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) passed++;
  else { failed++; console.error(`  FAIL: ${message}`); }
}

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request(`http://localhost:${port}${urlPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function malformed(urlPath, raw, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${port}${urlPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(raw),
        ...headers,
      },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

async function run() {
  port = 4100 + Math.floor(Math.random() * 400);
  server = await start(port);

  console.log("Security/Auth Matrix Tests");
  console.log("==========================");

  const roles = ["admin", "agent", "viewer", "anonymous"];
  const matrix = [
    { method: "GET", path: "/api/dashboard", allowed: ["admin", "agent", "viewer"] },
    { method: "GET", path: "/api/contacts", allowed: ["admin", "agent", "viewer"] },
    { method: "POST", path: "/api/contacts", body: { firstName: "Role", phone: "+15551230000" }, allowed: ["admin", "agent"] },
    { method: "GET", path: "/api/templates", allowed: ["admin", "agent", "viewer"] },
    { method: "POST", path: "/api/templates", body: { name: "Auth", channel: "sms", body: "Hi" }, allowed: ["admin"] },
    { method: "POST", path: "/api/campaigns/run", body: {}, allowed: ["admin", "agent"] },
    { method: "GET", path: "/api/settings", allowed: ["admin"] },
    { method: "POST", path: "/api/compliance/opt-out", body: { contactId: "contact_unknown", reason: "test" }, allowed: ["admin", "agent"] },
    { method: "GET", path: "/api/reconciliation", allowed: ["admin"] },
  ];

  for (const role of roles) {
    const header = { "x-user-role": role };
    for (const test of matrix) {
      const res = await request(test.method, test.path, test.body, header);
      const shouldAllow = test.allowed.includes(role);
      if (shouldAllow) assert(res.status !== 403, `${role} allowed for ${test.method} ${test.path}`);
      else assert(res.status === 403, `${role} forbidden for ${test.method} ${test.path}`);
    }
  }

  // Health is always unauthenticated
  const healthAnon = await request("GET", "/api/health", null, { "x-user-role": "anonymous" });
  assert(healthAnon.status === 200 && healthAnon.body.ok, "health endpoint allows anonymous");

  // Malformed JSON should not leak stack/config
  const badJson = await malformed("/api/contacts", "{\"firstName\":", { "x-user-role": "admin" });
  assert(badJson.status === 400, "malformed JSON returns 400");
  assert(!String(badJson.body.error || "").toLowerCase().includes("stack"), "malformed JSON error does not leak stack");

  // Input sanitization (null bytes stripped)
  const dirty = await request("POST", "/api/contacts", { firstName: "A\u0000lex", phone: "+15550007777" }, { "x-user-role": "admin" });
  const contacts = await request("GET", "/api/contacts", null, { "x-user-role": "admin" });
  const created = contacts.body.data.find((c) => c.id === dirty.body.data.id);
  assert(created && created.firstName === "Alex", "sanitization removes null bytes from input");

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  if (server) server.close();
  process.exit(1);
});
