/**
 * Integration tests — full HTTP request/response cycle.
 * Starts the server on a random port, exercises all key flows.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// Clean slate for tests
const dbPath = path.join(__dirname, "../.data/db.json");
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

// Set test env
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "warn";

const { start } = require("../backend/server");

let server;
let port;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    }).on("error", reject);
  });
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`http://localhost:${port}${urlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": data.length },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: d, headers: res.headers }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function put(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`http://localhost:${port}${urlPath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": data.length },
    }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: d, headers: res.headers }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  port = 3100 + Math.floor(Math.random() * 900);
  server = await start(port);

  console.log("Integration Tests");
  console.log("==================");

  // --- Health ---
  console.log("\nHealth:");
  const health = await get("/api/health");
  assert(health.body.ok, "health returns ok");
  assert(health.body.data.status === "healthy", "status is healthy");
  assert(health.headers["x-correlation-id"], "correlation ID in response");
  console.log("  health endpoint: OK");

  const ready = await get("/api/health?ready=1");
  assert(ready.body.ok && ready.body.data.ready, "readiness probe passes");
  console.log("  readiness probe: OK");

  // --- Contacts ---
  console.log("\nContacts:");
  const contactsList = await get("/api/contacts");
  assert(contactsList.body.ok, "contacts list OK");
  const seedContact = contactsList.body.data[0];
  assert(seedContact.firstName === "Alex", "seed contact exists");
  assert(Array.isArray(contactsList.body.data), "contacts empty-state shape is stable array");
  console.log("  list contacts: OK");

  const newContact = await post("/api/contacts", { firstName: "Jane", lastName: "Doe", phone: "+15550000002", email: "jane@example.com" });
  assert(newContact.body.ok && newContact.body.data.id, "create contact returns id");
  const janeId = newContact.body.data.id;
  console.log("  create contact: OK");

  // --- Templates ---
  console.log("\nTemplates:");
  const templatesList = await get("/api/templates");
  assert(templatesList.body.ok && templatesList.body.data.length >= 2, "templates seeded");
  console.log("  list templates: OK");

  // --- Campaigns ---
  console.log("\nCampaigns:");
  const tpl = templatesList.body.data[0];
  const campaign = await post("/api/campaigns", {
    name: "Test Campaign", contactId: seedContact.id, templateId: tpl.id,
    channel: "sms", followUpAfterDays: 1, followUpTemplateId: templatesList.body.data[1]?.id || "",
  });
  assert(campaign.body.ok && campaign.body.data.id, "create campaign returns id");
  const campId = campaign.body.data.id;
  console.log("  create campaign: OK");

  // Run campaign send
  const sendResult = await post("/api/campaigns/run", {});
  assert(sendResult.body.ok, "campaign run OK");
  assert(sendResult.body.data.length > 0, "campaign sent at least one");
  const sendResultAgain = await post("/api/campaigns/run", {});
  assert(sendResultAgain.body.ok, "second campaign run OK");
  assert(sendResultAgain.body.data.length === 0, "duplicate campaign run does not double-send");
  console.log("  campaign send: OK");

  // --- Inbox ---
  console.log("\nInbox:");
  const inbox = await get("/api/inbox");
  assert(inbox.body.ok && inbox.body.data.length > 0, "inbox has messages");
  console.log("  list inbox: OK");

  // --- Conversations ---
  console.log("\nConversations:");
  const convos = await get("/api/conversations");
  assert(convos.body.ok && convos.body.data.length > 0, "conversations created from send");
  console.log("  list conversations: OK");

  // --- Webhook inbound reply ---
  console.log("\nWebhooks:");
  const webhookReply = await post("/webhooks/sms-mock", { from: "+15550000001", body: "Sounds good!" });
  assert(webhookReply.body.ok && webhookReply.body.data.action === "reply", "webhook reply processed");
  console.log("  inbound reply via webhook: OK");

  // Duplicate webhook (idempotency)
  const webhookDupe = await post("/webhooks/sms-mock", { from: "+15550000001", body: "Sounds good!", providerMessageId: "dupe_test_1" });
  const webhookDupe2 = await post("/webhooks/sms-mock", { from: "+15550000001", body: "Sounds good!", providerMessageId: "dupe_test_1" });
  assert(webhookDupe2.body.data.duplicate === true, "duplicate webhook detected");
  console.log("  webhook idempotency: OK");

  // Webhook opt-out via STOP
  const webhookStop = await post("/webhooks/sms-mock", { from: "+15550000002", body: "STOP" });
  assert(webhookStop.body.ok && webhookStop.body.data.action === "opt-out", "STOP word triggers opt-out");
  console.log("  webhook opt-out: OK");

  // Verify contact is opted out
  const contactsAfter = await get("/api/contacts");
  const jane = contactsAfter.body.data.find((c) => c.id === janeId);
  assert(jane && jane.optedOut === true, "contact is opted out after STOP webhook");
  console.log("  opt-out persisted: OK");

  // Send to opted-out contact should fail
  const sendOptedOut = await post("/api/inbox/send", { contactId: janeId, body: "Test", channel: "sms" });
  assert(sendOptedOut.body.data.error === "Contact is opted out", "send to opted-out blocked");
  console.log("  send to opted-out blocked: OK");

  // Validation and deleted-record safety checks
  const missingBody = await post("/api/inbox/send", { contactId: seedContact.id, body: "", channel: "sms" });
  assert(missingBody.body.ok && missingBody.body.data.error === "Message body is required", "empty outbound body rejected");
  const missingContact = await post("/api/inbox/send", { contactId: "contact_missing", body: "hello", channel: "sms" });
  assert(missingContact.body.ok && missingContact.body.data.error === "Contact not found", "unknown contact send rejected");
  const deleted = await post("/api/contacts", { firstName: "Delete", phone: "+15553333333" });
  const deletedId = deleted.body.data.id;
  const deletedContactRes = await new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${port}/api/contacts/${deletedId}`, { method: "DELETE" }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on("error", reject);
    req.end();
  });
  assert(deletedContactRes.body.ok, "delete contact endpoint succeeds");
  const deletedSend = await post("/api/inbox/send", { contactId: deletedId, body: "after delete", channel: "sms" });
  assert(deletedSend.body.ok && deletedSend.body.data.error === "Contact not found", "send after delete rejected");

  // --- Activity Log ---
  console.log("\nActivity:");
  const activities = await get("/api/activity-log");
  assert(activities.body.ok && activities.body.data.length > 0, "activities logged");
  console.log("  activity log populated: OK");

  // --- Dashboard ---
  console.log("\nDashboard:");
  const dash = await get("/api/dashboard");
  assert(dash.body.ok && dash.body.data.totals, "dashboard returns totals");
  assert(dash.body.data.totals.sent > 0, "dashboard shows sent count");
  console.log("  dashboard read model: OK");

  // --- Reconciliation ---
  console.log("\nReconciliation:");
  const recon = await get("/api/reconciliation");
  assert(recon.body.ok && recon.body.data.generatedAt, "reconciliation report generated");
  assert(recon.body.data.conflictCampaigns && typeof recon.body.data.conflictCampaigns.count === "number", "reconciliation includes conflict count");
  console.log("  reconciliation report: OK");

  // --- Settings ---
  console.log("\nSettings:");
  const settings = await get("/api/settings");
  assert(settings.body.ok && settings.body.data.orgName, "settings returns org name");
  console.log("  get settings: OK");

  // --- Roles ---
  console.log("\nRoles:");
  const roles = await get("/api/roles");
  assert(roles.body.ok && roles.body.data.permissions, "roles returns permissions");
  console.log("  get roles: OK");

  // --- Rate Limits ---
  console.log("\nRate Limits:");
  const limits = await get("/api/rate-limits");
  assert(limits.body.ok && limits.body.data.configured, "rate limits returns config");
  console.log("  rate limit status: OK");

  // --- 404 ---
  console.log("\nError handling:");
  const notFound = await get("/api/nonexistent");
  assert(notFound.status === 404 || notFound.body.ok === false, "404 for unknown route");
  console.log("  404 handling: OK");

  // --- Unknown webhook provider ---
  const badWebhook = await post("/webhooks/sms-unknown", { body: "test" });
  assert(!badWebhook.body.ok || badWebhook.body.data?.processed === false, "unknown webhook provider rejected");
  console.log("  unknown webhook provider: OK");

  console.log(`\n${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  if (server) server.close();
  process.exit(1);
});
