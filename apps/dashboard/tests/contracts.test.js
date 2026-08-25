/**
 * Contract tests — validate domain event schemas and webhook schemas.
 */

const { EVENT_TYPES, makeDomainEvent, validateEvent } = require("../contracts/v1/domain-events");
const { WEBHOOK_EVENT_TYPES, normalizeWebhookPayload } = require("../contracts/v1/webhook-schemas");

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

function test(name, fn) {
  console.log(`  ${name}`);
  fn();
}

console.log("Contract Tests");
console.log("==============");

console.log("\nDomain Events:");

test("makeDomainEvent creates valid envelope", () => {
  const event = makeDomainEvent({
    type: EVENT_TYPES.CAMPAIGN_CREATED,
    aggregateType: "campaign",
    aggregateId: "camp_123",
    payload: { campaignId: "camp_123", contactId: "c_1", channel: "sms" },
  });
  assert(event.id.startsWith("evt_"), "event id has correct prefix");
  assert(event.type === "campaign.created", "type is campaign.created");
  assert(event.version === 1, "version is 1");
  assert(event.occurredAt, "occurredAt is set");
  assert(event.payload.campaignId === "camp_123", "payload preserved");
});

test("validateEvent rejects missing fields", () => {
  const event = makeDomainEvent({
    type: EVENT_TYPES.MESSAGE_SENT,
    payload: { messageId: "msg_1" }, // missing contactId, channel, providerMessageId
  });
  const result = validateEvent(event);
  assert(!result.valid, "validation fails for incomplete payload");
  assert(result.errors.length === 3, "reports 3 missing fields");
});

test("validateEvent passes with complete payload", () => {
  const event = makeDomainEvent({
    type: EVENT_TYPES.MESSAGE_SENT,
    payload: { messageId: "msg_1", contactId: "c_1", channel: "sms", providerMessageId: "prov_1" },
  });
  assert(validateEvent(event).valid, "validation passes");
});

test("validateEvent checks all event types", () => {
  const types = [
    { type: EVENT_TYPES.CAMPAIGN_CREATED, payload: { campaignId: "c", contactId: "c", channel: "sms" } },
    { type: EVENT_TYPES.MESSAGE_SENT, payload: { messageId: "m", contactId: "c", channel: "sms", providerMessageId: "p" } },
    { type: EVENT_TYPES.REPLY_RECEIVED, payload: { messageId: "m", contactId: "c", channel: "sms", body: "hi" } },
    { type: EVENT_TYPES.OPT_OUT_RECEIVED, payload: { contactId: "c", reason: "stop" } },
    { type: EVENT_TYPES.NO_RESPONSE_TRIGGERED, payload: { campaignId: "c", contactId: "c", daysSinceSend: 3 } },
  ];
  for (const { type, payload } of types) {
    const event = makeDomainEvent({ type, payload });
    assert(validateEvent(event).valid, `${type} validates with complete payload`);
  }
});

test("validateEvent rejects unknown event type", () => {
  const event = makeDomainEvent({ type: "unknown.event", payload: {} });
  const result = validateEvent(event);
  assert(!result.valid, "unknown type fails");
  assert(result.errors[0].includes("Unknown"), "error mentions unknown type");
});

console.log("\nWebhook Schemas:");

test("normalizeWebhookPayload produces correct shape", () => {
  const payload = normalizeWebhookPayload({
    type: WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE,
    provider: "twilio",
    providerMessageId: "SM123",
    from: "+1555",
    to: "+1666",
    body: "Hello",
    channel: "sms",
  });
  assert(payload.type === "inbound.message", "type is inbound.message");
  assert(payload.provider === "twilio", "provider is twilio");
  assert(payload.receivedAt, "receivedAt is set");
  assert(payload.rawPayload !== undefined, "rawPayload exists");
});

test("normalizeWebhookPayload defaults", () => {
  const payload = normalizeWebhookPayload({});
  assert(payload.type === "inbound.message", "default type");
  assert(payload.provider === "unknown", "default provider");
  assert(payload.channel === "sms", "default channel");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
