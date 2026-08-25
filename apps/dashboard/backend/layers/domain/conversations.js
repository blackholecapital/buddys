/**
 * Conversation / message-thread model.
 *
 * Unifies SMS and email messages into conversation threads per contact.
 * A conversation groups messages between the org and a single contact,
 * optionally scoped to a campaign. This avoids future refactors when
 * rendering inbox and activity views.
 */

const { readDb, mutate } = require("../core/db");
const { id, nowIso } = require("../../../shared/schemas");

function normalizeConversation(input = {}) {
  return {
    id: input.id || id("conv"),
    contactId: input.contactId || "",
    campaignId: input.campaignId || null,
    channel: input.channel || "sms",
    subject: input.subject || null,
    status: input.status || "open", // open | closed | archived
    lastMessageAt: input.lastMessageAt || null,
    messageCount: input.messageCount || 0,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

/**
 * Find or create a conversation for a contact+campaign+channel tuple.
 */
function findOrCreate({ contactId, campaignId, channel, subject }) {
  const db = readDb();
  if (!db.conversations) db.conversations = [];

  const existing = db.conversations.find(
    (c) =>
      c.contactId === contactId &&
      c.channel === channel &&
      (campaignId ? c.campaignId === campaignId : !c.campaignId)
  );
  if (existing) return existing;

  const conversation = normalizeConversation({ contactId, campaignId, channel, subject });
  mutate((next) => {
    if (!next.conversations) next.conversations = [];
    next.conversations.push(conversation);
    return next;
  });
  return conversation;
}

/**
 * Record a new message in a conversation, updating thread metadata.
 */
function addMessage(conversationId, messageId) {
  mutate((db) => {
    if (!db.conversations) db.conversations = [];
    db.conversations = db.conversations.map((c) =>
      c.id === conversationId
        ? {
            ...c,
            lastMessageAt: nowIso(),
            messageCount: (c.messageCount || 0) + 1,
            updatedAt: nowIso(),
          }
        : c
    );
    return db;
  });
}

/**
 * List conversations, optionally filtered by contactId.
 */
function list(filters = {}) {
  const db = readDb();
  let convos = db.conversations || [];
  if (filters.contactId) convos = convos.filter((c) => c.contactId === filters.contactId);
  if (filters.status) convos = convos.filter((c) => c.status === filters.status);
  return convos.sort((a, b) => (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt));
}

/**
 * Get a single conversation with its messages.
 */
function getWithMessages(conversationId) {
  const db = readDb();
  const conversation = (db.conversations || []).find((c) => c.id === conversationId);
  if (!conversation) return null;
  const messages = db.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { conversation, messages };
}

/**
 * Update conversation status.
 */
function updateStatus(conversationId, status) {
  mutate((db) => {
    if (!db.conversations) db.conversations = [];
    db.conversations = db.conversations.map((c) =>
      c.id === conversationId ? { ...c, status, updatedAt: nowIso() } : c
    );
    return db;
  });
}

module.exports = { normalizeConversation, findOrCreate, addMessage, list, getWithMessages, updateStatus };
