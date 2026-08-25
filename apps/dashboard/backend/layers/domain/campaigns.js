const { readDb, mutate } = require("../core/db");
const { normalizeCampaign, nowIso } = require("../../../shared/schemas");
const activity = require("./activity");
const eventBus = require("../../../shared/event-bus");
const { EVENT_TYPES, makeDomainEvent } = require("../../../contracts/v1/domain-events");
const metrics = require("../../../shared/metrics");
const logger = require("../../../shared/logger");

const CAMPAIGN_STATUSES = ["scheduled", "sent", "failed", "cancelled"];
const LOCK_STALE_MS = 2 * 60 * 1000;

function isStaleLock(lockIso) {
  if (!lockIso) return false;
  const lockAt = new Date(lockIso).getTime();
  if (!lockAt) return true;
  return (Date.now() - lockAt) > LOCK_STALE_MS;
}

function list() { return readDb().campaigns; }

function create(input) {
  const campaign = normalizeCampaign(input);
  mutate((db) => {
    db.campaigns.unshift(campaign);
    return db;
  });
  activity.record({
    type: "campaign.created", entityType: "campaign", entityId: campaign.id,
    message: `Scheduled campaign ${campaign.name}`,
  });

  // Emit domain event (fire-and-forget, don't await in sync path)
  eventBus.emit(makeDomainEvent({
    type: EVENT_TYPES.CAMPAIGN_CREATED,
    aggregateType: "campaign", aggregateId: campaign.id,
    payload: {
      campaignId: campaign.id, contactId: campaign.contactId,
      channel: campaign.channel, templateId: campaign.templateId,
      scheduledAt: campaign.scheduledAt,
    },
  }));

  metrics.increment("campaigns.created");
  return campaign;
}

function markSent(id) {
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) =>
      c.id === id ? { ...c, status: "sent", sentAt: nowIso(), updatedAt: nowIso(), sendLockedAt: "", failureReason: "" } : c
    );
    return db;
  });
}

function markFailed(id, reason) {
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) =>
      c.id === id ? { ...c, status: "failed", failureReason: reason, updatedAt: nowIso(), sendLockedAt: "" } : c
    );
    return db;
  });
  metrics.increment("campaigns.failed");
}

function markFollowUpQueued(id) {
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) =>
      c.id === id ? { ...c, followUpQueuedAt: nowIso(), updatedAt: nowIso(), followUpLockedAt: "" } : c
    );
    return db;
  });
}

function claimScheduledForSend(id) {
  let claimed = false;
  let staleRecovered = false;
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) => {
      if (c.id === id && c.status === "scheduled" && (!c.sendLockedAt || isStaleLock(c.sendLockedAt))) {
        claimed = true;
        staleRecovered = Boolean(c.sendLockedAt && isStaleLock(c.sendLockedAt));
        return { ...c, sendLockedAt: nowIso(), updatedAt: nowIso() };
      }
      return c;
    });
    return db;
  });
  if (claimed) logger.info("Campaign send claimed", { campaignId: id, staleRecovered });
  return claimed;
}

function claimFollowUp(id) {
  let claimed = false;
  let staleRecovered = false;
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) => {
      if (c.id === id && c.status === "sent" && !c.followUpQueuedAt && (!c.followUpLockedAt || isStaleLock(c.followUpLockedAt))) {
        claimed = true;
        staleRecovered = Boolean(c.followUpLockedAt && isStaleLock(c.followUpLockedAt));
        return { ...c, followUpLockedAt: nowIso(), updatedAt: nowIso() };
      }
      return c;
    });
    return db;
  });
  if (claimed) logger.info("Campaign follow-up claimed", { campaignId: id, staleRecovered });
  return claimed;
}

function releaseFollowUpClaim(id) {
  mutate((db) => {
    db.campaigns = db.campaigns.map((c) =>
      c.id === id ? { ...c, followUpLockedAt: "", updatedAt: nowIso() } : c
    );
    return db;
  });
  logger.warn("Campaign follow-up claim released", { campaignId: id });
}

module.exports = {
  list,
  create,
  markSent,
  markFailed,
  markFollowUpQueued,
  claimScheduledForSend,
  claimFollowUp,
  releaseFollowUpClaim,
  LOCK_STALE_MS,
  CAMPAIGN_STATUSES,
};
