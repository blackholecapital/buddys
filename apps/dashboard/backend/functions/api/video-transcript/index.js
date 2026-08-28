const { readDb, mutate } = require("../../../layers/core/db");
const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const conversations = require("../../../layers/domain/conversations");
const buddyEvents = require("../../../layers/domain/buddy-events");
const { normalizeMessage } = require("../../../../shared/schemas");

function cleanMessage(input = {}, index = 0) {
  const role = String(input.role || "").toLowerCase() === "customer" ? "customer" : "buddy";
  const text = String(input.text || "").trim().slice(0, 4000);
  const segmentId = String(input.segmentId || input.id || `segment-${index}`).slice(0, 240);
  const at = Number(input.at || Date.now());
  return { role, text, segmentId, at };
}

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };
  if (!env?.BUDDY_DB) return { ok:false, error:"Buddy event database is not configured" };

  const contactId = String(body?.contactId || "").trim();
  if (!contactId) return { ok:true, skipped:true, reason:"No lead is linked to this session" };

  const contact = readDb().contacts.find((row) => row && row.id === contactId);
  if (!contact) return { ok:false, error:"Contact not found" };

  const room = String(body?.room || "").trim().slice(0, 240);
  const sessionId = String(body?.sessionId || room || `video-${Date.now()}`).trim().slice(0, 240);
  const ended = body?.ended === true;
  const transcript = (Array.isArray(body?.messages) ? body.messages : [])
    .slice(0, 100)
    .map(cleanMessage)
    .filter((entry) => entry.text);

  const conversation = transcript.length
    ? conversations.findOrCreate({
        contactId,
        campaignId:null,
        channel:"video",
        subject:"Buddy live video",
      })
    : null;

  const current = readDb();
  const existingIds = new Set(
    (current.messages || [])
      .filter((message) => message.contactId === contactId && message.channel === "video")
      .map((message) => message.providerMessageId)
      .filter(Boolean),
  );
  const newMessages = [];

  for (const entry of transcript) {
    if (existingIds.has(entry.segmentId)) continue;
    existingIds.add(entry.segmentId);

    const event = {
      type:"video.transcript.final",
      role:entry.role,
      contactId,
      callSid:sessionId,
      streamSid:room,
      transcript:entry.text,
      segmentId:entry.segmentId,
      ts:entry.at,
      source:"buddy-livekit-web",
    };
    await buddyEvents.record(env.BUDDY_DB, event);
    newMessages.push(normalizeMessage({
      contactId,
      campaignId:sessionId,
      conversationId:conversation.id,
      channel:"video",
      direction:entry.role === "customer" ? "inbound" : "outbound",
      providerMessageId:entry.segmentId,
      body:entry.text,
      status:entry.role === "customer" ? "received" : "sent",
      createdAt:new Date(entry.at).toISOString(),
      automationStep:"live-video",
    }));
  }

  if (newMessages.length) {
    mutate((next) => {
      next.messages.push(...newMessages);
      return next;
    });
    for (const message of newMessages) conversations.addMessage(conversation.id, message.id);
  }

  if (ended) {
    await buddyEvents.record(env.BUDDY_DB, {
      type:"video.session.completed",
      contactId,
      callSid:sessionId,
      streamSid:room,
      message:`Video session completed with ${transcript.length} transcript messages`,
      ts:Date.now(),
      source:"buddy-livekit-web",
    });
    if (contact.callStatus !== "Video completed") {
      contacts.update(contactId, { stage:"Engaged", callStatus:"Video completed" });
      activity.record({
        type:"video.completed",
        entityType:"contact",
        entityId:contactId,
        message:`Buddy live video completed for ${contact.firstName || contact.email || contact.phone}`,
        metadata:{ room, sessionId, transcriptMessages:transcript.length, conversationId:conversation?.id || "" },
      });
    }
  }

  return {
    ok:true,
    contactId,
    sessionId,
    savedMessages:newMessages.length,
    conversationId:conversation?.id || null,
    ended,
  };
};
