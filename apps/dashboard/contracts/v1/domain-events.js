/**
 * Domain Event Schemas — contracts/v1
 *
 * Locked contract definitions for domain events.
 * All event producers and consumers MUST conform to these shapes.
 * Breaking changes require a new version (v2/).
 */

const EVENT_TYPES = {
  CAMPAIGN_CREATED: "campaign.created",
  MESSAGE_SENT: "message.sent",
  REPLY_RECEIVED: "reply.received",
  OPT_OUT_RECEIVED: "opt-out.received",
  NO_RESPONSE_TRIGGERED: "no-response.triggered",
};

/**
 * Every domain event envelope has this shape.
 * payload varies per event type — see schemas below.
 */
function makeDomainEvent({ type, aggregateType, aggregateId, payload, idempotencyKey, causationId }) {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    aggregateType: aggregateType || "",
    aggregateId: aggregateId || "",
    payload: payload || {},
    idempotencyKey: idempotencyKey || null,
    causationId: causationId || null,
    occurredAt: new Date().toISOString(),
    version: 1,
  };
}

/** Schema validators — return { valid, errors } */
const eventSchemas = {
  [EVENT_TYPES.CAMPAIGN_CREATED]: (p) => {
    const errors = [];
    if (!p.campaignId) errors.push("campaignId required");
    if (!p.contactId) errors.push("contactId required");
    if (!p.channel) errors.push("channel required");
    return { valid: errors.length === 0, errors };
  },
  [EVENT_TYPES.MESSAGE_SENT]: (p) => {
    const errors = [];
    if (!p.messageId) errors.push("messageId required");
    if (!p.contactId) errors.push("contactId required");
    if (!p.channel) errors.push("channel required");
    if (!p.providerMessageId) errors.push("providerMessageId required");
    return { valid: errors.length === 0, errors };
  },
  [EVENT_TYPES.REPLY_RECEIVED]: (p) => {
    const errors = [];
    if (!p.messageId) errors.push("messageId required");
    if (!p.contactId) errors.push("contactId required");
    if (!p.channel) errors.push("channel required");
    if (!p.body) errors.push("body required");
    return { valid: errors.length === 0, errors };
  },
  [EVENT_TYPES.OPT_OUT_RECEIVED]: (p) => {
    const errors = [];
    if (!p.contactId) errors.push("contactId required");
    if (!p.reason) errors.push("reason required");
    return { valid: errors.length === 0, errors };
  },
  [EVENT_TYPES.NO_RESPONSE_TRIGGERED]: (p) => {
    const errors = [];
    if (!p.campaignId) errors.push("campaignId required");
    if (!p.contactId) errors.push("contactId required");
    if (!p.daysSinceSend) errors.push("daysSinceSend required");
    return { valid: errors.length === 0, errors };
  },
};

function validateEvent(event) {
  const validator = eventSchemas[event.type];
  if (!validator) return { valid: false, errors: [`Unknown event type: ${event.type}`] };
  return validator(event.payload);
}

module.exports = {
  EVENT_TYPES,
  makeDomainEvent,
  eventSchemas,
  validateEvent,
};
