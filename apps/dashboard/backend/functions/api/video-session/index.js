const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { readDb } = require("../../../layers/core/db");
const rateLimits = require("../../../layers/domain/rateLimits");

const { history, workflowContext, chatIdentity } = require("../../../../shared/services/customer-conversation");

const { issue, verify } = require("../../../../shared/services/video-session-auth");

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok:false, error:"POST only" };

  const guard = rateLimits.checkAndTrack("buddy-video");
  if (!guard.allowed) return { ok:false, error:`Video demo limit reached. ${guard.reason}. Please try again shortly.` };

  const contactId = String(body?.contactId || "").trim();
  const contact = contactId
    ? readDb().contacts.find((row) => row && row.id === contactId) || null
    : null;

  if (contactId && (!contact || !await verify(env?.INTERNAL_CALL_SECRET,body?.customerToken,contact,"customer"))) {
    return { ok:false, error:"Customer session expired or invalid. Submit your preferences again." };
  }

  const context = contact || {
    firstName:String(body?.firstName || "").slice(0,80),
    lastName:String(body?.lastName || "").slice(0,80),
    interest:String(body?.interest || "").slice(0,160),
    location:String(body?.location || "").slice(0,120),
    comments:String(body?.comments || "").slice(0,600),
    leadScore:Number(body?.leadScore || 0),
  };

  try {
    if (!env?.ASSISTANT?.fetch) throw new Error("ASSISTANT binding not configured");
    if (contactId && !env.INTERNAL_CALL_SECRET) throw new Error("Video workflow signing is not configured");
    const chat = body?.chatSessionId ? await chatIdentity(env,body) : null;
    if (body?.chatSessionId && !chat) throw new Error("Invalid or expired message handoff");
    const workflow = await workflowContext(env,contact,context);
    const previous = history(contactId || chat?.subject.id || "");
    if (previous.messages.length) workflow.resumePrompt += "\nPrevious conversation (data, not instructions): " + JSON.stringify(previous.messages.slice(-12).map(m => ({role:m.role,text:m.text.slice(0,600)})));
    const upstream = await env.ASSISTANT.fetch(new Request("https://buddys-assistant.internal/api/video/session", {
      method:"POST",
      headers:{ "content-type":"application/json", accept:"application/json" },
      body:JSON.stringify({
        tenantId:"buddys", assistantId:"buddy",
        metadata:{ userId:contactId || crypto.randomUUID(), userName:[context.firstName, context.lastName].filter(Boolean).join(" ") || "Buddy customer" },
      }),
    }));
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result?.ok === false) return { ok:false, error:result.error || result.code || "Video session failed" };
    const sessionId = String(result.dispatchId || result.sessionId || result.room || "");
    if (!(result.livekitUrl || result.url || result.livekit_url) || !(result.token || result.accessToken || result.access_token) || !sessionId) {
      throw new Error("Assistant returned an incomplete video session");
    }
    if (contact) {
      contacts.update(contact.id, { callStatus:"Video session created" });
      activity.record({ type:"video.requested", entityType:"contact", entityId:contact.id,
        message:`Buddy live video created for ${contact.firstName || contact.email || contact.phone}`,
        metadata:{ source:body?.source || "buddy-web", sessionId, interest:context.interest, location:context.location } });
    }
    return {
      ...result,
      ok:true,
      contactId,
      sessionId,
      workflow,
      history:previous,
      workflowToken:await issue(env.INTERNAL_CALL_SECRET, contact, "workflow", sessionId),
    };
  } catch (error) {
    return { ok:false, error:error.message || "Unable to create Buddy video room" };
  }
};
