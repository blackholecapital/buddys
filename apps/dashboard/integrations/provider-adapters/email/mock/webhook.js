/**
 * Mock Email Webhook Adapter.
 *
 * Translates mock/dev webhook payloads into the normalized webhook schema.
 */

const { normalizeWebhookPayload, WEBHOOK_EVENT_TYPES } = require("../../../../contracts/v1/webhook-schemas");

/**
 * Parse a raw webhook body from the mock email provider.
 * Dev payloads: { from, to, body, subject?, providerMessageId? }
 */
function parse(rawBody) {
  return normalizeWebhookPayload({
    type: WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE,
    provider: "mock-email",
    providerMessageId: rawBody.providerMessageId || `mock_email_in_${Date.now()}`,
    from: rawBody.from || "",
    to: rawBody.to || "",
    body: rawBody.body || "",
    channel: "email",
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
