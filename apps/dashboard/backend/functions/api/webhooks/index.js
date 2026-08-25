/**
 * Webhook Ingestion Handler.
 *
 * Receives inbound webhooks from provider adapters, normalizes them,
 * and dispatches domain events. Idempotent — duplicate deliveries are safe.
 */

const { getAdapter } = require("../../../../integrations/provider-adapters/webhook-router");
const { WEBHOOK_EVENT_TYPES } = require("../../../../contracts/v1/webhook-schemas");
const { EVENT_TYPES, makeDomainEvent } = require("../../../../contracts/v1/domain-events");
const eventBus = require("../../../../shared/event-bus");
const idempotency = require("../../../../shared/idempotency");
const { conciergePost } = require("../../../../shared/services/concierge");
const inbox = require("../../../layers/domain/inbox");
const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const compliance = require("../../../layers/domain/compliance");
const { readDb } = require("../../../layers/core/db");

function requestsCall(body = "") {
  const normalized = String(body).trim().toUpperCase();
  return normalized === "YES" || normalized === "CALL" || normalized === "YES CALL";
}

module.exports = async function handler({ method, body, params, env }) {
  if (method !== "POST") return { ok: false, error: "POST only" };

  const providerKey = params.providerKey;
  const adapter = getAdapter(providerKey);
  if (!adapter) return { ok: false, error: `Unknown provider: ${providerKey}` };

  // Verify signature (no-op for mocks, async for real adapters)
  const verified = await adapter.verify(body, params.signature);
  if (!verified) {
    return { ok: false, error: "Invalid webhook signature" };
  }

  // Normalize the raw payload
  const normalized = adapter.parse(body);

  // Idempotency check on providerMessageId
  const dedupeKey = idempotency.makeKey("webhook", normalized.provider, normalized.providerMessageId);
  const existing = idempotency.check(dedupeKey);
  if (existing.duplicate) {
    return { ok: true, data: { duplicate: true, originalResult: existing.result } };
  }

  let result;

  if (normalized.type === WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE) {
    // Resolve contact by phone/email
    const db = readDb();
    const contact = db.contacts.find((c) =>
      normalized.channel === "sms" ? c.phone === normalized.from : c.email === normalized.from
    );
    if (!contact) {
      result = { processed: false, reason: "Unknown sender" };
      idempotency.mark(dedupeKey, result);
      return { ok: true, data: result };
    }

    // Check for stop words → opt-out
    if (compliance.detectStopWord(normalized.body)) {
      compliance.optOut({ contactId: contact.id, reason: "stop-word via webhook" });
      await eventBus.emit(
        makeDomainEvent({
          type: EVENT_TYPES.OPT_OUT_RECEIVED,
          aggregateType: "contact",
          aggregateId: contact.id,
          payload: { contactId: contact.id, reason: "stop-word", body: normalized.body, channel: normalized.channel },
          idempotencyKey: dedupeKey,
        })
      );
      result = { processed: true, action: "opt-out", contactId: contact.id };
    } else {
      // Find the most recent outbound message to this contact for threading
      const recentOutbound = db.messages
        .filter((m) => m.contactId === contact.id && m.direction === "outbound")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      const reply = inbox.receiveReply({
        contactId: contact.id,
        campaignId: recentOutbound?.campaignId || "",
        body: normalized.body,
        channel: normalized.channel,
        replyToMessageId: recentOutbound?.id || "",
      });

      await eventBus.emit(
        makeDomainEvent({
          type: EVENT_TYPES.REPLY_RECEIVED,
          aggregateType: "message",
          aggregateId: reply.id,
          payload: {
            messageId: reply.id,
            contactId: contact.id,
            channel: normalized.channel,
            body: normalized.body,
            campaignId: recentOutbound?.campaignId || "",
          },
          idempotencyKey: dedupeKey,
        })
      );

      let callRequest = null;
      if (normalized.channel === "sms" && requestsCall(normalized.body)) {
        const updatedContact = contacts.update(contact.id, {
          stage: "Engaged",
          callStatus: "Call requested",
        }) || contact;

        activity.record({
          type: "call.requested",
          entityType: "contact",
          entityId: contact.id,
          message: `Voice call requested by ${updatedContact.firstName || updatedContact.phone}`,
          metadata: {
            source: "sms-reply",
            body: normalized.body,
            leadScore: updatedContact.leadScore,
            interest: updatedContact.interest,
            location: updatedContact.location,
          },
        });

        try {
          callRequest = await conciergePost(env, "/internal/calls", {
            contactId: updatedContact.id,
            contact: updatedContact,
            context: {
              firstName: updatedContact.firstName,
              lastName: updatedContact.lastName,
              phone: updatedContact.phone,
              email: updatedContact.email,
              interest: updatedContact.interest,
              location: updatedContact.location,
              comments: updatedContact.comments,
              leadScore: updatedContact.leadScore,
              preferredContactTime: updatedContact.preferredContactTime,
              source: updatedContact.source,
            },
            trigger: {
              type: "sms-reply",
              body: normalized.body,
              messageId: reply.id,
            },
          });
        } catch (err) {
          callRequest = { ok: false, error: err.message };
        }
      }

      result = {
        processed: true,
        action: callRequest ? "reply-and-call-request" : "reply",
        messageId: reply.id,
        contactId: contact.id,
        callRequest,
      };
    }
  } else if (normalized.type === WEBHOOK_EVENT_TYPES.OPT_OUT) {
    const db = readDb();
    const contact = db.contacts.find((c) =>
      normalized.channel === "sms" ? c.phone === normalized.from : c.email === normalized.from
    );
    if (contact) {
      compliance.optOut({ contactId: contact.id, reason: "provider opt-out webhook" });
      result = { processed: true, action: "opt-out", contactId: contact.id };
    } else {
      result = { processed: false, reason: "Unknown sender" };
    }
  } else {
    result = { processed: false, reason: `Unhandled webhook type: ${normalized.type}` };
  }

  idempotency.mark(dedupeKey, result);
  return { ok: true, data: result };
};
