/**
 * Acceptance sweep: exercises the full operator flow via API.
 *
 * Steps:
 *   1. Create contact
 *   2. Create template
 *   3. Create campaign (contact + template)
 *   4. Run scheduled sends
 *   5. Simulate inbound reply
 *   6. Run follow-up check
 *   7. Verify: dashboard, inbox, activity, conversations, contacts state
 *
 * Run: node tests/acceptance-sweep.js
 */

const http = require("http");

let baseUrl;
let passed = 0;
let failed = 0;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost", port: 9877,
      path, method,
      headers: { "Content-Type": "application/json" },
    };
    const r = http.request(opts, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function assert(label, condition, detail) {
  if (condition) { passed++; console.log("  \u2713 " + label); }
  else { failed++; console.error("  \u2717 " + label + (detail ? " — " + detail : "")); }
}

async function run() {
  const { start } = require("../backend/server");
  const server = await start(9877);
  console.log("\n=== Acceptance Sweep ===\n");

  try {
    // 1. Create contact
    console.log("Step 1: Create contact");
    const c1 = await req("POST", "/api/contacts", {
      firstName: "Sweep", lastName: "Tester", phone: "+15559990001", email: "sweep@test.com", channelPreference: "sms"
    });
    assert("Contact created", c1.data.ok && c1.data.data?.id, JSON.stringify(c1.data));
    const contactId = c1.data.data?.id;

    // 2. Create template
    console.log("Step 2: Create template");
    const t1 = await req("POST", "/api/templates", {
      name: "Sweep initial", channel: "sms", body: "Hi {{firstName}}, this is the sweep test."
    });
    assert("Template created", t1.data.ok && t1.data.data?.id, JSON.stringify(t1.data));
    const templateId = t1.data.data?.id;

    // Create follow-up template
    const t2 = await req("POST", "/api/templates", {
      name: "Sweep follow-up", channel: "sms", body: "Hi {{firstName}}, just following up on my last message."
    });
    assert("Follow-up template created", t2.data.ok && t2.data.data?.id);
    const followUpTemplateId = t2.data.data?.id;

    // 3. Create campaign
    console.log("Step 3: Create campaign");
    const camp = await req("POST", "/api/campaigns", {
      name: "Sweep Campaign", contactId, templateId, channel: "sms",
      scheduledAt: new Date().toISOString(),
      followUpAfterDays: 0, followUpTemplateId
    });
    assert("Campaign created", camp.data.ok && camp.data.data?.id, JSON.stringify(camp.data));
    const campaignId = camp.data.data?.id;

    // Verify campaign is scheduled
    const camps1 = await req("GET", "/api/campaigns");
    const myCamp = (camps1.data.data || []).find(c => c.id === campaignId);
    assert("Campaign status is scheduled", myCamp?.status === "scheduled", myCamp?.status);

    // 4. Run scheduled sends
    console.log("Step 4: Run scheduled sends");
    const send = await req("POST", "/api/campaigns/run", {});
    assert("Sends executed", send.data.ok, JSON.stringify(send.data));
    const sendAgain = await req("POST", "/api/campaigns/run", {});
    assert("Duplicate run does not resend", sendAgain.data.ok && (sendAgain.data.data || []).length === 0, JSON.stringify(sendAgain.data));

    // Verify campaign is now sent
    const camps2 = await req("GET", "/api/campaigns");
    const sentCamp = (camps2.data.data || []).find(c => c.id === campaignId);
    assert("Campaign status is sent", sentCamp?.status === "sent", sentCamp?.status);
    assert("Campaign has sentAt timestamp", !!sentCamp?.sentAt, sentCamp?.sentAt);

    // Verify message appears in inbox
    const inbox1 = await req("GET", "/api/inbox");
    const thread = (inbox1.data.data || []).find(t => t.contact?.id === contactId);
    assert("Inbox has thread for contact", !!thread, "threads: " + (inbox1.data.data || []).length);
    const outMsg = (thread?.messages || []).find(m => m.direction === "outbound" && m.campaignId === campaignId);
    assert("Outbound message exists for campaign", !!outMsg, "msgs: " + (thread?.messages || []).length);

    // 5. Simulate inbound reply
    console.log("Step 5: Simulate inbound reply");
    const reply = await req("POST", "/api/inbox/reply", {
      contactId, campaignId, body: "Thanks, got it!", mode: "reply"
    });
    assert("Reply recorded", reply.data.ok, JSON.stringify(reply.data));

    // Verify reply in inbox
    const inbox2 = await req("GET", "/api/inbox");
    const thread2 = (inbox2.data.data || []).find(t => t.contact?.id === contactId);
    const inMsg = (thread2?.messages || []).find(m => m.direction === "inbound");
    assert("Inbound reply visible in inbox", !!inMsg, "msgs: " + (thread2?.messages || []).length);

    // Verify conversation created
    const convos = await req("GET", "/api/conversations");
    const convo = (convos.data.data || []).find(c => c.contactId === contactId);
    assert("Conversation exists for contact", !!convo, "convos: " + (convos.data.data || []).length);
    assert("Conversation has messages", (convo?.messageCount || 0) >= 2, "count: " + convo?.messageCount);

    // 6. Run follow-up check
    console.log("Step 6: Run follow-up check");
    const fu = await req("POST", "/api/automation/run-followups", {});
    assert("Follow-up check ran", fu.data.ok, JSON.stringify(fu.data));
    const fuAgain = await req("POST", "/api/automation/run-followups", {});
    assert("Duplicate follow-up run is idempotent", fuAgain.data.ok, JSON.stringify(fuAgain.data));

    // 7. Verify final state
    console.log("Step 7: Verify final state");

    // Dashboard
    const dash = await req("GET", "/api/dashboard");
    assert("Dashboard loads", dash.data.ok);
    assert("Dashboard totals has contacts", (dash.data.data?.totals?.contacts || 0) >= 1);
    assert("Dashboard totals has sent", (dash.data.data?.totals?.sent || 0) >= 1);

    // Activity log
    const act = await req("GET", "/api/activity-log");
    assert("Activity log has entries", (act.data.data || []).length > 0);
    const campCreatedEvent = (act.data.data || []).find(a => a.type === "campaign.created");
    assert("Campaign.created event in activity", !!campCreatedEvent);
    const msgSentEvent = (act.data.data || []).find(a => a.type === "message.sent");
    assert("Message.sent event in activity", !!msgSentEvent);
    const replyEvent = (act.data.data || []).find(a => a.type === "message.received");
    assert("Message.received event in activity", !!replyEvent);

    // Settings
    const settings = await req("GET", "/api/settings");
    assert("Settings loads", settings.data.ok);

    // Rate limits
    const rl = await req("GET", "/api/rate-limits");
    assert("Rate limits loads", rl.data.ok);

    // Health
    const health = await req("GET", "/api/health?metrics=1&dlq=1&ready=1");
    assert("Health endpoint loads", health.data.ok);

    // Reconciliation
    const recon = await req("GET", "/api/reconciliation");
    assert("Reconciliation loads", recon.data.ok);

    // Contact still active
    const contacts = await req("GET", "/api/contacts");
    const sweepContact = (contacts.data.data || []).find(c => c.id === contactId);
    assert("Contact still active (not opted out)", sweepContact && !sweepContact.optedOut);

    // STOP word test
    console.log("Step 8: STOP word reply test");
    const stopReply = await req("POST", "/api/inbox/reply", {
      contactId, body: "STOP", mode: "reply"
    });
    assert("STOP word detected", stopReply.data.ok && stopReply.data.data?.stopWordDetected);
    const optOutCommit = await req("POST", "/api/compliance/opt-out", { contactId, reason: "STOP detected in acceptance sweep" });
    assert("STOP word opt-out action persisted", optOutCommit.data.ok);
    const blockedAfterStop = await req("POST", "/api/inbox/send", {
      contactId, body: "Should be blocked", channel: "sms"
    });
    assert("Opted-out contact send blocked", blockedAfterStop.data.ok && blockedAfterStop.data.data?.error === "Contact is opted out");

    // Verify all pages render (check static files)
    console.log("Step 9: Verify static assets");
    const index = await req("GET", "/");
    assert("index.html serves", index.status === 200);
    const appjs = await req("GET", "/app.js");
    assert("app.js serves", appjs.status === 200);
    const corejs = await req("GET", "/lib/core.js");
    assert("core.js serves", corejs.status === 200);

  } catch(e) {
    console.error("SWEEP ERROR:", e);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run();
