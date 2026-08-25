const { readDb, mutate } = require("../core/db");
const { normalizeMessage } = require("../../../shared/schemas");
const { getProvider } = require("../providers");
const templates = require("./templates");
const activity = require("./activity");
const rateLimits = require("./rateLimits");
const conversations = require("./conversations");
const compliance = require("./compliance");
const eventBus = require("../../../shared/event-bus");
const { EVENT_TYPES, makeDomainEvent } = require("../../../contracts/v1/domain-events");
const idempotency = require("../../../shared/idempotency");
const { withRetry, sendToDlq } = require("../../../shared/retry");
const metrics = require("../../../shared/metrics");
const logger = require("../../../shared/logger");

function list() {
  const db = readDb();
  return db.contacts.map((contact) => ({
    contact,
    messages: db.messages.filter((m) => m.contactId === contact.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  })).filter((row) => row.messages.length > 0);
}

async function send({ contactId, campaignId = "", templateId = "", body = "", channel = "sms", automationStep = "manual", idempotencyKey = "" }) {
  // Idempotency guard for sends
  const dedupeKey = idempotencyKey || idempotency.makeKey("send", contactId, campaignId, templateId, automationStep);
  const existing = idempotency.check(dedupeKey);
  if (existing.duplicate) {
    logger.info("Idempotent send skipped", { dedupeKey, contactId });
    return existing.result;
  }

  const db = readDb();
  const contact = db.contacts.find((c) => c.id === contactId);
  if (!contact) return { error: "Contact not found" };

  // Compliance: check opt-out before send
  if (contact.optedOut) {
    logger.warn("Send blocked: contact opted out", { contactId });
    return { error: "Contact is opted out" };
  }

  const rate = rateLimits.checkAndTrack("send");
  if (!rate.allowed) {
    logger.warn("Send rate-limited", { contactId, reason: rate.reason });
    return { error: rate.reason };
  }

  let messageBody = body;
  if (!messageBody && templateId) {
    const template = db.templates.find((t) => t.id === templateId);
    if (!template) return { error: "Template not found" };
    messageBody = templates.render(template, contact);
  }
  if (!messageBody) return { error: "Message body is required" };

  // Send with retry
  const provider = getProvider(channel, db.settings);
  const target = channel === "email" ? contact.email : contact.phone;
  logger.info("Sending message", { contactId, channel, target, automationStep });

  const sendResult = await withRetry(
    () => provider.send({ to: target, body: messageBody, subject: `Campaign ${campaignId || "manual"}` }),
    { maxRetries: 2 }
  );

  if (!sendResult.ok) {
    const failedMessage = normalizeMessage({
      contactId, campaignId, channel, direction: "outbound",
      body: messageBody, status: "failed", automationStep,
    });
    mutate((next) => { next.messages.push(failedMessage); return next; });
    sendToDlq({ type: "send-failure", messageId: failedMessage.id, contactId, error: sendResult.error });
    metrics.increment("messages.send.failed");
    logger.error("Send failed after retries", { contactId, error: sendResult.error, messageId: failedMessage.id });
    const errorResult = { error: sendResult.error, messageId: failedMessage.id, status: "failed" };
    idempotency.mark(dedupeKey, errorResult);
    return errorResult;
  }

  const result = sendResult.result;
  const message = normalizeMessage({
    contactId, campaignId, channel, direction: "outbound",
    providerMessageId: result.providerMessageId,
    body: messageBody, status: "sent", automationStep,
  });

  // Thread into conversation
  const conversation = conversations.findOrCreate({ contactId, campaignId, channel });
  message.conversationId = conversation.id;

  mutate((next) => { next.messages.push(message); return next; });
  conversations.addMessage(conversation.id, message.id);

  activity.record({
    type: "message.sent", entityType: "message", entityId: message.id,
    message: `Sent ${channel} message to ${contact.firstName || target}`,
    metadata: { campaignId, automationStep },
  });

  await eventBus.emit(makeDomainEvent({
    type: EVENT_TYPES.MESSAGE_SENT,
    aggregateType: "message", aggregateId: message.id,
    payload: {
      messageId: message.id, contactId, channel,
      providerMessageId: result.providerMessageId,
      campaignId, automationStep,
    },
    idempotencyKey: dedupeKey,
  }));

  metrics.increment("messages.send.ok");
  logger.info("Message sent", { messageId: message.id, contactId, channel, providerMessageId: result.providerMessageId });
  idempotency.mark(dedupeKey, message);
  return message;
}

function receiveReply({ contactId, campaignId = "", body = "", channel = "sms", replyToMessageId = "" }) {
  const db = readDb();
  const contact = db.contacts.find((c) => c.id === contactId);
  if (!contact) return { error: "Contact not found" };

  // Compliance: check for stop words on inbound
  if (compliance.detectStopWord(body)) {
    compliance.optOut({ contactId: contact.id, reason: "stop-word in reply" });
    logger.info("Auto opt-out on reply stop word", { contactId, body });
  }

  const message = normalizeMessage({
    contactId, campaignId, channel, direction: "inbound",
    body, status: "received", replyToMessageId, automationStep: "reply",
  });

  // Thread into conversation
  const conversation = conversations.findOrCreate({ contactId, campaignId, channel });
  message.conversationId = conversation.id;

  mutate((next) => { next.messages.push(message); return next; });
  conversations.addMessage(conversation.id, message.id);

  activity.record({
    type: "message.received", entityType: "message", entityId: message.id,
    message: `Received ${channel} reply from ${contact.firstName || contact.id}`,
  });

  metrics.increment("messages.received");
  logger.info("Reply received", { messageId: message.id, contactId, channel });
  return message;
}

module.exports = { list, send, receiveReply };
