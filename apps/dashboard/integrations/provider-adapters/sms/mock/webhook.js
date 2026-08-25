/**
 * Mock SMS Webhook Adapter.
 *
 * Translates mock/dev webhook payloads into the normalized webhook schema.
 * In dev mode, the frontend or test harness posts mock inbound messages here.
 */

const { normalizeWebhookPayload, WEBHOOK_EVENT_TYPES } = require("../../../../contracts/v1/webhook-schemas");

/**
 * Parse a raw webhook body from the mock SMS provider.
 * Dev payloads: { from, to, body, providerMessageId? }
 */
function parse(rawBody) {
  return normalizeWebhookPayload({
    type: WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE,
    provider: "mock-sms",
    providerMessageId: rawBody.providerMessageId || `mock_sms_in_${Date.now()}`,
    from: rawBody.from || "",
    to: rawBody.to || "",
    body: rawBody.body || "",
    channel: "sms",
    rawPayload: rawBody,
  });
}

/**
 * Verify webhook signature (no-op for mock).
 */
function verify(_rawBody, _signature) {
  return true;
}

module.exports = { parse, verify };
