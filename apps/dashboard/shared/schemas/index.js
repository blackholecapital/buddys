const CHANNELS = ["sms", "email", "video"];
const ROLES = ["admin", "agent", "viewer"];

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeContact(input = {}) {
  return {
    id: input.id || id("contact"),
    firstName: ensureString(input.firstName),
    lastName: ensureString(input.lastName),
    phone: ensureString(input.phone),
    email: ensureString(input.email),
    channelPreference: CHANNELS.includes(input.channelPreference) ? input.channelPreference : (input.phone ? "sms" : "email"),
    optedOut: Boolean(input.optedOut),

    // Lead / Buddy workflow context. These fields are intentionally optional so
    // generic contacts remain valid while lead-created contacts keep the data
    // needed by the AI call workflow and operator dashboard.
    interest: ensureString(input.interest || input.productInterest || input.product_interest),
    leadSource: ensureString(input.leadSource || input.lead_source),
    location: ensureString(input.location || input.preferredStore || input.preferred_store),
    preferredContactMethod: ensureString(input.preferredContactMethod || input.contactMethod || input.contact_method),
    preferredContactTime: ensureString(input.preferredContactTime || input.contactTime || input.contact_time),
    comments: ensureString(input.comments || input.notes),
    smsConsent: Boolean(input.smsConsent ?? input.consent),
    owner: ensureString(input.owner),
    company: ensureString(input.company),
    source: ensureString(input.source) || "Buddy web lead",
    leadScore: Number.isFinite(Number(input.leadScore)) ? Number(input.leadScore) : null,
    stage: ensureString(input.stage) || "New Lead",
    callStatus: ensureString(input.callStatus) || "Not called",
    documentStatus: ensureString(input.documentStatus) || "Not sent",
    deliveryAt: input.deliveryAt || null,
    value: Number.isFinite(Number(input.value)) ? Number(input.value) : 0,

    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeTemplate(input = {}) {
  return {
    id: input.id || id("tpl"),
    name: ensureString(input.name),
    channel: CHANNELS.includes(input.channel) ? input.channel : "sms",
    body: ensureString(input.body),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeCampaign(input = {}) {
  return {
    id: input.id || id("camp"),
    name: ensureString(input.name) || "Untitled campaign",
    contactId: ensureString(input.contactId),
    templateId: ensureString(input.templateId),
    channel: CHANNELS.includes(input.channel) ? input.channel : "sms",
    scheduledAt: input.scheduledAt || nowIso(),
    status: input.status || "scheduled",
    followUpAfterDays: Number.isFinite(Number(input.followUpAfterDays)) ? Number(input.followUpAfterDays) : 3,
    followUpTemplateId: ensureString(input.followUpTemplateId),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
    sentAt: input.sentAt || null,
    followUpQueuedAt: input.followUpQueuedAt || null
  };
}

const MESSAGE_STATUSES = ["queued", "sent", "received", "failed", "delivered", "bounced"];

function normalizeMessage(input = {}) {
  return {
    id: input.id || id("msg"),
    contactId: ensureString(input.contactId),
    campaignId: ensureString(input.campaignId),
    conversationId: ensureString(input.conversationId),
    channel: [...CHANNELS, "chat"].includes(input.channel) ? input.channel : "sms",
    direction: input.direction === "inbound" ? "inbound" : "outbound",
    providerMessageId: ensureString(input.providerMessageId),
    body: ensureString(input.body),
    status: MESSAGE_STATUSES.includes(input.status) ? input.status : "queued",
    createdAt: input.createdAt || nowIso(),
    replyToMessageId: ensureString(input.replyToMessageId),
    automationStep: input.automationStep || "initial"
  };
}

function normalizeActivity(input = {}) {
  return {
    id: input.id || id("act"),
    type: ensureString(input.type) || "system.event",
    entityType: ensureString(input.entityType),
    entityId: ensureString(input.entityId),
    message: ensureString(input.message),
    createdAt: input.createdAt || nowIso(),
    metadata: input.metadata || {}
  };
}

function normalizeSettings(input = {}) {
  return {
    orgName: ensureString(input.orgName) || "Pass 1 Demo Org",
    defaultChannel: CHANNELS.includes(input.defaultChannel) ? input.defaultChannel : "sms",
    rateLimits: {
      perMinute: Number(input?.rateLimits?.perMinute || 20),
      perHour: Number(input?.rateLimits?.perHour || 200)
    },
    compliance: {
      honorStopWords: true,
      stopWords: input?.compliance?.stopWords || ["STOP", "UNSUBSCRIBE", "END"]
    },
    providers: {
      sms: input?.providers?.sms || "mock",
      email: input?.providers?.email || "mock"
    },
    updatedAt: nowIso()
  };
}

module.exports = {
  CHANNELS,
  ROLES,
  MESSAGE_STATUSES,
  id,
  nowIso,
  normalizeContact,
  normalizeTemplate,
  normalizeCampaign,
  normalizeMessage,
  normalizeActivity,
  normalizeSettings
};
