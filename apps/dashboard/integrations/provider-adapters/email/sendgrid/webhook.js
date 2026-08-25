/**
 * SendGrid Email Webhook Adapter.
 *
 * Edge-safe: no Node crypto dependency.
 */

const { normalizeWebhookPayload, WEBHOOK_EVENT_TYPES } = require("../../../../contracts/v1/webhook-schemas");
const logger = require("../../../../shared/logger");
const env = require("../../../../shared/env");

function parse(rawBody) {
  const from = rawBody.from || rawBody.From || "";
  const to = rawBody.to || rawBody.To || "";
  const body = rawBody.text || rawBody.body || rawBody.Body || "";
  const messageId = rawBody["Message-ID"] || rawBody.providerMessageId || `sg_in_${Date.now()}`;

  const emailMatch = from.match(/<([^>]+)>/) || [null, from];
  const fromEmail = emailMatch[1] || from;

  return normalizeWebhookPayload({
    type: WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE,
    provider: "sendgrid",
    providerMessageId: messageId,
    from: fromEmail, to, body,
    channel: "email",
    rawPayload: rawBody,
  });
}

async function verify(rawBody, signature) {
  const verificationKey = env.get("SENDGRID_API_KEY");
  if (!verificationKey) {
    logger.warn("SendGrid API key not set, skipping signature verification");
    return true;
  }
  // Full ECDSA verification requires the public key — stub for now
  return true;
}

module.exports = { parse, verify };
