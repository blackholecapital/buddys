/**
 * Webhook Schemas — contracts/v1
 *
 * Defines the normalized inbound webhook shape that all provider adapters
 * must produce, regardless of upstream provider format.
 */

const WEBHOOK_EVENT_TYPES = {
  INBOUND_MESSAGE: "inbound.message",
  DELIVERY_STATUS: "delivery.status",
  OPT_OUT: "opt-out",
};

/**
 * Normalized webhook payload that provider adapters produce.
 * Provider-specific adapters translate raw payloads into this shape.
 */
function normalizeWebhookPayload({
  type,
  provider,
  providerMessageId,
  from,
  to,
  body,
  channel,
  deliveryStatus,
  rawPayload,
}) {
  return {
    type: type || WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE,
    provider: provider || "unknown",
    providerMessageId: providerMessageId || "",
    from: from || "",
    to: to || "",
    body: body || "",
    channel: channel || "sms",
    deliveryStatus: deliveryStatus || null,
    rawPayload: rawPayload || {},
    receivedAt: new Date().toISOString(),
  };
}

module.exports = {
  WEBHOOK_EVENT_TYPES,
  normalizeWebhookPayload,
};
