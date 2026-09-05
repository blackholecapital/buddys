const { readDb, mutate } = require("../../../layers/core/db");
const conversations = require("../../../layers/domain/conversations");
const rateLimits = require("../../../layers/domain/rateLimits");
const { issue, verify } = require("../../../../shared/services/video-session-auth");
const { history, workflowContext, chatIdentity } = require("../../../../shared/services/customer-conversation");

module.exports = async function handler({ method, body = {}, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };
  if (!env?.INTERNAL_CALL_SECRET) return { ok:false, error:"Customer session signing is not configured" };
  const guard = rateLimits.checkAndTrack("buddy-chat-session");
  if (!guard.allowed) return { ok:false, error:`Message session limit reached. ${guard.reason}` };
  try {
    let identity;
    if (body.chatSessionId || body.chatToken) {
      identity = await chatIdentity(env, body);
      if (!identity && body.contactId) {
        const contact = readDb().contacts.find(c => c.id === body.contactId);
        if (await verify(env.INTERNAL_CALL_SECRET, body.customerToken, contact, "customer")) {
          const guest = await chatIdentity(env,{...body,contactId:""});
          if (guest) {
            // Both capabilities are required to attach a guest thread to a lead.
            mutate(db => {
              db.conversations.find(c => c.id === guest.conversation.id).contactId = contact.id;
              for (const message of db.messages) if (message.conversationId === guest.conversation.id) message.contactId = contact.id;
              return db;
            });
            identity = {...guest,contact,subject:contact};
          } else {
            const conversation = conversations.findOrCreate({contactId:contact.id,channel:"chat",subject:"Message Buddy"});
            identity = {contact,subject:contact,conversation};
          }
        }
      }
      if (!identity) return { ok:false, code:"chat_session_expired", error:"Message session expired or invalid. Reopen messaging to start a new guest conversation, or submit your preferences again." };
    } else {
      const contactId = String(body.contactId || "");
      const contact = contactId ? readDb().contacts.find(c => c.id === contactId) : null;
      if (contactId && !await verify(env.INTERNAL_CALL_SECRET, body.customerToken, contact, "customer")) {
        return { ok:false, error:"Customer session expired or invalid. Submit your preferences again." };
      }
      // Guests get a private thread, not a synthetic CRM lead or any commerce authority.
      const guestSession = crypto.randomUUID();
      const subject = contact || { id:`guest:${guestSession}` };
      const conversation = contact
        ? conversations.findOrCreate({contactId,channel:"chat",subject:"Message Buddy"})
        : conversations.normalizeConversation({id:guestSession,contactId:subject.id,channel:"chat",subject:"Guest message"});
      if (!contact) mutate(db => { db.conversations ||= []; db.conversations.push(conversation); return db; });
      identity = {contact,subject,conversation};
    }
    const {contact,subject,conversation} = identity;
    const workflow = contact ? await workflowContext(env,contact) : {
      phase:"guest", productOptions:[], resumePrompt:"Help the customer explore their needs. Ask them to complete the shopping preferences form before selecting products, sending agreements or booking delivery. Do not invent product facts or claim any action completed.",
    };
    return {ok:true,contactId:contact?.id || "",chatSessionId:conversation.id,
      chatToken:await issue(env.INTERNAL_CALL_SECRET,subject,"chat",conversation.id),
      sessionId:conversation.id, workflowToken:await issue(env.INTERNAL_CALL_SECRET,contact,"workflow",conversation.id),
      history:history(subject.id),workflow};
  } catch (error) { return {ok:false,error:error.message || "Unable to open messaging"}; }
};
