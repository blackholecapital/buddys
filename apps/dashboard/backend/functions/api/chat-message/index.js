const { readDb, mutate } = require("../../../layers/core/db");
const conversations = require("../../../layers/domain/conversations");
const rateLimits = require("../../../layers/domain/rateLimits");
const { normalizeMessage } = require("../../../../shared/schemas");
const { history, workflowContext, chatIdentity } = require("../../../../shared/services/customer-conversation");

module.exports = async function handler({ method, body = {}, env }) {
  if (method !== "POST") return {ok:false,error:"POST only"};
  const identity = await chatIdentity(env,body);
  if (!identity) return {ok:false,error:"Invalid or expired message session"};
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const requestId = String(body.requestId || "");
  if (!text || text.length > 4000 || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return {ok:false,error:"A message (up to 4000 characters) and request ID are required"};
  const {contact,subject,conversation} = identity;
  const prefix = `chat:${conversation.id}:${requestId}`;
  const saved = (readDb().messages || []).filter(m => m.conversationId === conversation.id && String(m.providerMessageId || "").startsWith(prefix + ":"));
  if (saved.length) {
    if (saved.find(m => m.direction === "inbound")?.body !== text) return {ok:false,error:"Request ID already used for another message"};
    const reply = saved.find(m => m.direction === "outbound");
    if (reply) return {ok:true,response:reply.body,replayed:true};
  }
  const guard = rateLimits.checkAndTrack(`buddy-chat:${subject.id}`);
  if (!guard.allowed) return {ok:false,error:`Message limit reached. ${guard.reason}`};
  try {
    if (!env?.ASSISTANT?.fetch) throw new Error("Messaging service is not configured");
    const workflow = contact ? await workflowContext(env,contact) : {
      resumePrompt:"Help explore shopping needs. Ask the customer to complete the shopping preferences form before product selection, agreements or delivery. Never invent stock, pricing or completed actions.",
    };
    // Fit below the sealed adapter's 20-message / 24K prompt bounds. Client-supplied
    // histories and roles are never forwarded; actions remain explicit signed calls.
    const previous = history(subject.id).messages.slice(-12).map(m => ({role:m.role === "customer" ? "user" : "assistant",content:m.text.slice(0,900)}));
    const upstream = await env.ASSISTANT.fetch(new Request("https://buddys-assistant.internal/api/chat", {
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({tenantId:"buddys",assistantId:"buddy",messages:[
        {role:"user",content:`[BUDDY WORKFLOW — server state]\n${workflow.resumePrompt}`.slice(0,4000)},
        ...previous,{role:"user",content:text},
      ]}),
    }));
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || result.ok !== true || typeof result.response !== "string" || !result.response.trim()) throw new Error("Buddy messaging is temporarily unavailable. Please retry your message.");
    const reply = result.response.trim().slice(0,4000);
    const messages = [["inbound",text],["outbound",reply]].map(([direction,value]) => normalizeMessage({
      id:crypto.randomUUID(),contactId:subject.id,conversationId:conversation.id,channel:"chat",direction,
      providerMessageId:`${prefix}:${direction}`,body:value,status:direction === "inbound" ? "received" : "sent",automationStep:"buddy-chat",
    }));
    mutate(db => {db.messages.push(...messages);return db;});
    for (const message of messages) conversations.addMessage(conversation.id,message.id);
    return {ok:true,response:reply};
  } catch (error) { return {ok:false,error:error.message || "Buddy messaging is unavailable"}; }
};
