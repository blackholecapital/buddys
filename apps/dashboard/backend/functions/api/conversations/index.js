/**
 * Conversations API handler.
 * List conversations or get a conversation with its messages.
 */

const conversations = require("../../../layers/domain/conversations");

module.exports = async function handler({ method, body, params }) {
  if (method === "GET" && params.id) {
    const result = conversations.getWithMessages(params.id);
    if (!result) return { ok: false, error: "Conversation not found" };
    return { ok: true, data: result };
  }
  if (method === "GET") {
    return { ok: true, data: conversations.list(body || {}) };
  }
  return { ok: false, error: "Unsupported conversations operation" };
};
