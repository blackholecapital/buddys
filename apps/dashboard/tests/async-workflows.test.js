/**
 * Async workflow tests — validates event-driven flows, retry behavior,
 * idempotency across worker paths, and compliance enforcement.
 */

const fs = require("fs");
const path = require("path");

// Clean DB for tests
const dbPath = path.join(__dirname, "../.data/db.json");
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";

// Initialize persistence backend before importing domain modules
const db = require("../backend/layers/core/db");
const fileStore = require("../backend/layers/core/file-store");
db.setBackend(fileStore);

const { readDb, mutate } = db;
const contacts = require("../backend/layers/domain/contacts");
const templates = require("../backend/layers/domain/templates");
const campaigns = require("../backend/layers/domain/campaigns");
const inbox = require("../backend/layers/domain/inbox");
const compliance = require("../backend/layers/domain/compliance");
const conversations = require("../backend/layers/domain/conversations");
const eventBus = require("../shared/event-bus");
const idempotency = require("../shared/idempotency");
const { withRetry, sendToDlq, getDlq, clearDlq } = require("../shared/retry");
const { EVENT_TYPES } = require("../contracts/v1/domain-events");
const campaignSendJob = require("../worker/jobs/campaign-send");
const followupCheckJob = require("../worker/jobs/followup-check");

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

async function run() {
  console.log("Async Workflow Tests");
  console.log("====================");

  // Setup: create contact and templates
  const contact = contacts.create({ firstName: "Test", lastName: "User", phone: "+15559999999", email: "test@example.com" });
  const tpl1 = templates.create({ name: "Initial", channel: "sms", body: "Hi {{firstName}}!" });
  const tpl2 = templates.create({ name: "Follow-up", channel: "sms", body: "Following up, {{firstName}}." });

  // --- Event emission ---
  console.log("\nEvent Emission:");
  const capturedEvents = [];
  const handler = (e) => capturedEvents.push(e);
  eventBus.on(EVENT_TYPES.MESSAGE_SENT, handler);
  eventBus.on(EVENT_TYPES.CAMPAIGN_CREATED, handler);

  const campaign = campaigns.create({
    name: "Workflow Test", contactId: contact.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  // Wait for async event
  await new Promise((r) => setTimeout(r, 50));
  assert(capturedEvents.some((e) => e.type === EVENT_TYPES.CAMPAIGN_CREATED), "campaign.created event emitted");
  console.log("  campaign.created event: OK");

  // --- Campaign send job ---
  console.log("\nCampaign Send:");
  idempotency.clear();
  const sendResults = await campaignSendJob.run();
  assert(sendResults.length > 0, "campaign send produced results");
  assert(!sendResults[0].result.error, "campaign send succeeded");
  await new Promise((r) => setTimeout(r, 50));
  assert(capturedEvents.some((e) => e.type === EVENT_TYPES.MESSAGE_SENT), "message.sent event emitted");
  console.log("  send job + event: OK");

  // Idempotent re-run
  const sendResults2 = await campaignSendJob.run();
  // Should find no new due campaigns (already marked sent)
  assert(sendResults2.length === 0, "idempotent re-run finds nothing new");
  console.log("  idempotent re-run: OK");

  // Parallel run race should not double-send same campaign
  const raceContact = contacts.create({ firstName: "Race", lastName: "Case", phone: "+15556666666" });
  const raceCampaign = campaigns.create({
    name: "Race Campaign", contactId: raceContact.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  const [raceRunA, raceRunB] = await Promise.all([campaignSendJob.run(), campaignSendJob.run()]);
  const raceMsgs = readDb().messages.filter((m) => m.campaignId === raceCampaign.id && m.direction === "outbound");
  assert(raceMsgs.length === 1, "parallel send runs produce only one outbound message");
  assert(raceRunA.length + raceRunB.length >= 1, "parallel send runs return processed/skipped entries");
  console.log("  parallel send race: OK");

  // Fresh lock blocks execution; stale lock recovers safely
  const lockContact = contacts.create({ firstName: "Lock", lastName: "Fresh", phone: "+15551110000" });
  const lockCampaign = campaigns.create({
    name: "Fresh Lock Campaign", contactId: lockContact.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  mutate((data) => {
    data.campaigns = data.campaigns.map((c) =>
      c.id === lockCampaign.id ? { ...c, sendLockedAt: new Date().toISOString() } : c
    );
    return data;
  });
  const freshLockRun = await campaignSendJob.run();
  const freshLockMsgs = readDb().messages.filter((m) => m.campaignId === lockCampaign.id && m.direction === "outbound");
  assert(freshLockMsgs.length === 0, "fresh send lock prevents send");
  assert(freshLockRun.some((r) => r.campaignId === lockCampaign.id && r.reason === "already-claimed"), "fresh lock reports claim-unavailable");

  const staleContact = contacts.create({ firstName: "Lock", lastName: "Stale", phone: "+15551110001" });
  const staleCampaign = campaigns.create({
    name: "Stale Lock Campaign", contactId: staleContact.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  mutate((data) => {
    data.campaigns = data.campaigns.map((c) =>
      c.id === staleCampaign.id ? { ...c, sendLockedAt: new Date(Date.now() - (campaigns.LOCK_STALE_MS + 5000)).toISOString() } : c
    );
    return data;
  });
  const staleLockRun = await campaignSendJob.run();
  const staleLockMsgs = readDb().messages.filter((m) => m.campaignId === staleCampaign.id && m.direction === "outbound");
  assert(staleLockMsgs.length === 1, "stale send lock is recovered and sent");
  assert(staleLockRun.some((r) => r.campaignId === staleCampaign.id), "stale lock campaign processed");
  console.log("  stale lock recovery: OK");

  // --- Conversation threading ---
  console.log("\nConversation Threading:");
  const convos = conversations.list({ contactId: contact.id });
  assert(convos.length > 0, "conversation created for send");
  const convo = convos[0];
  assert(convo.messageCount >= 1, "conversation has messages");
  console.log("  conversation threaded: OK");

  // --- Reply handling ---
  console.log("\nReply Handling:");
  const reply = inbox.receiveReply({
    contactId: contact.id, campaignId: campaign.id,
    body: "Yes I am interested", channel: "sms",
  });
  assert(reply.id && reply.direction === "inbound", "reply created");
  assert(reply.conversationId === convo.id, "reply threaded to same conversation");
  console.log("  reply threaded correctly: OK");

  // --- Compliance: STOP word in reply ---
  console.log("\nCompliance:");
  const contact2 = contacts.create({ firstName: "Opt", lastName: "Out", phone: "+15558888888" });
  const stopReply = inbox.receiveReply({
    contactId: contact2.id, body: "STOP", channel: "sms",
  });
  const db = readDb();
  const c2 = db.contacts.find((c) => c.id === contact2.id);
  assert(c2.optedOut === true, "STOP word in reply triggers opt-out");
  console.log("  STOP word auto opt-out: OK");

  // Send to opted-out contact blocked
  const blocked = await inbox.send({ contactId: contact2.id, body: "Hello", channel: "sms" });
  assert(blocked.error === "Contact is opted out", "send to opted-out blocked");
  console.log("  opted-out send blocked: OK");

  // --- Follow-up check ---
  console.log("\nFollow-up Check:");
  // Create a campaign that was sent but has no reply
  idempotency.clear();
  const contact3 = contacts.create({ firstName: "Noreply", lastName: "User", phone: "+15557777777" });
  const camp2 = campaigns.create({
    name: "No Reply Test", contactId: contact3.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  // Manually mark as sent in the past
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) =>
      c.id === camp2.id ? { ...c, status: "sent", sentAt: new Date(Date.now() - 86400000).toISOString() } : c
    );
    return db;
  });

  const noResponseHandler = (e) => capturedEvents.push(e);
  eventBus.on(EVENT_TYPES.NO_RESPONSE_TRIGGERED, noResponseHandler);

  const followupResults = await followupCheckJob.run();
  assert(followupResults.length > 0, "followup check produced results");
  assert(!followupResults[0].result.error, "followup send succeeded");
  await new Promise((r) => setTimeout(r, 50));
  assert(capturedEvents.some((e) => e.type === EVENT_TYPES.NO_RESPONSE_TRIGGERED), "no-response.triggered event emitted");
  console.log("  no-response follow-up: OK");

  // Idempotent followup re-run
  const followup2 = await followupCheckJob.run();
  const camp2After = readDb().campaigns.find((c) => c.id === camp2.id);
  assert(camp2After.followUpQueuedAt, "followup marked as queued");
  console.log("  followup idempotent: OK");

  // Parallel follow-up runs should not send duplicate follow-up messages
  const followRaceContact = contacts.create({ firstName: "Follow", lastName: "Race", phone: "+15554444444" });
  const followRace = campaigns.create({
    name: "Follow-up Race", contactId: followRaceContact.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  mutate((data) => {
    data.campaigns = data.campaigns.map((c) =>
      c.id === followRace.id ? { ...c, status: "sent", sentAt: new Date(Date.now() - 86400000).toISOString() } : c
    );
    return data;
  });
  const [followRunA, followRunB] = await Promise.all([followupCheckJob.run(), followupCheckJob.run()]);
  const followMsgs = readDb().messages.filter((m) => m.campaignId === followRace.id && m.direction === "outbound" && m.automationStep === "followup");
  assert(followMsgs.length === 1, "parallel follow-up runs produce only one follow-up message");
  assert(followRunA.length + followRunB.length >= 1, "parallel follow-up runs return processed/skipped entries");
  console.log("  parallel follow-up race: OK");

  const staleFollowContact = contacts.create({ firstName: "Follow", lastName: "Stale", phone: "+15554443333" });
  const staleFollowCampaign = campaigns.create({
    name: "Stale Follow Claim", contactId: staleFollowContact.id, templateId: tpl1.id,
    channel: "sms", followUpAfterDays: 0, followUpTemplateId: tpl2.id,
  });
  mutate((data) => {
    data.campaigns = data.campaigns.map((c) =>
      c.id === staleFollowCampaign.id
        ? {
          ...c,
          status: "sent",
          sentAt: new Date(Date.now() - 86400000).toISOString(),
          followUpLockedAt: new Date(Date.now() - (campaigns.LOCK_STALE_MS + 5000)).toISOString(),
        }
        : c
    );
    return data;
  });
  await followupCheckJob.run();
  const staleFollowMsgs = readDb().messages.filter((m) => m.campaignId === staleFollowCampaign.id && m.automationStep === "followup");
  assert(staleFollowMsgs.length === 1, "stale follow-up lock is recovered and processed");
  console.log("  stale follow-up lock recovery: OK");

  // --- Retry and DLQ ---
  console.log("\nRetry & DLQ:");
  clearDlq();
  let callCount = 0;
  const result = await withRetry(() => {
    callCount++;
    if (callCount < 3) throw new Error("transient");
    return { success: true };
  }, { maxRetries: 3, baseDelayMs: 10 });
  assert(result.ok && result.attempts === 3, "retry succeeds on 3rd attempt");
  console.log("  retry with backoff: OK");

  const failResult = await withRetry(() => { throw new Error("permanent"); }, { maxRetries: 1, baseDelayMs: 10 });
  assert(!failResult.ok, "retry fails after exhausting attempts");
  console.log("  retry exhaustion: OK");

  sendToDlq({ type: "test", error: "test error" });
  assert(getDlq().length === 1, "DLQ item stored");
  console.log("  DLQ storage: OK");

  // --- Idempotency ---
  console.log("\nIdempotency:");
  idempotency.clear();
  const key = idempotency.makeKey("test", "a", "b");
  assert(key === "test::a::b", "makeKey produces correct format");
  assert(!idempotency.check(key).duplicate, "new key is not duplicate");
  idempotency.mark(key, { result: "cached" });
  const checked = idempotency.check(key);
  assert(checked.duplicate && checked.result.result === "cached", "marked key returns cached result");
  console.log("  idempotency check/mark: OK");

  // Cleanup
  eventBus.off(EVENT_TYPES.MESSAGE_SENT, handler);
  eventBus.off(EVENT_TYPES.CAMPAIGN_CREATED, handler);
  eventBus.off(EVENT_TYPES.NO_RESPONSE_TRIGGERED, noResponseHandler);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
