const { readDb } = require("../../../backend/layers/core/db");
const campaigns = require("../../../backend/layers/domain/campaigns");
const inbox = require("../../../backend/layers/domain/inbox");
const eventBus = require("../../../shared/event-bus");
const { EVENT_TYPES, makeDomainEvent } = require("../../../contracts/v1/domain-events");
const idempotency = require("../../../shared/idempotency");
const metrics = require("../../../shared/metrics");
const logger = require("../../../shared/logger");

async function run() {
  const db = readDb();
  const results = [];

  for (const campaign of db.campaigns) {
    if (campaign.status !== "sent" || campaign.followUpQueuedAt) continue;
    const sentAt = campaign.sentAt ? new Date(campaign.sentAt).getTime() : 0;
    const threshold = sentAt + (Number(campaign.followUpAfterDays) * 24 * 60 * 60 * 1000);
    const hasReply = db.messages.some((m) => m.campaignId === campaign.id && m.direction === "inbound");

    if (!hasReply && campaign.followUpTemplateId && sentAt && Date.now() >= threshold) {
      const claimed = campaigns.claimFollowUp(campaign.id);
      if (!claimed) {
        logger.warn("Follow-up skipped: claim unavailable", { campaignId: campaign.id });
        results.push({ campaignId: campaign.id, skipped: true, reason: "already-claimed" });
        continue;
      }

      // Idempotency: skip if already processed
      const dedupeKey = idempotency.makeKey("followup", campaign.id);
      const existing = idempotency.check(dedupeKey);
      if (existing.duplicate) {
        logger.info("Follow-up reused cached result", { campaignId: campaign.id, sent: Boolean(existing.result?.sent) });
        if (existing.result?.sent) campaigns.markFollowUpQueued(campaign.id);
        else campaigns.releaseFollowUpClaim(campaign.id);
        results.push({ campaignId: campaign.id, result: existing.result, skipped: true });
        continue;
      }

      // Emit no-response event
      const daysSinceSend = Math.floor((Date.now() - sentAt) / (24 * 60 * 60 * 1000));
      await eventBus.emit(makeDomainEvent({
        type: EVENT_TYPES.NO_RESPONSE_TRIGGERED,
        aggregateType: "campaign", aggregateId: campaign.id,
        payload: {
          campaignId: campaign.id, contactId: campaign.contactId,
          daysSinceSend, followUpTemplateId: campaign.followUpTemplateId,
        },
      }));

      const sent = await inbox.send({
        contactId: campaign.contactId,
        campaignId: campaign.id,
        templateId: campaign.followUpTemplateId,
        channel: campaign.channel,
        automationStep: "followup",
        idempotencyKey: idempotency.makeKey("send", campaign.contactId, campaign.id, campaign.followUpTemplateId, "followup"),
      });

      if (!sent.error) {
        logger.info("Follow-up send success", { campaignId: campaign.id, messageId: sent.id });
        campaigns.markFollowUpQueued(campaign.id);
        idempotency.mark(dedupeKey, { sent: true, messageId: sent.id });
      } else {
        logger.error("Follow-up send failed", { campaignId: campaign.id, error: sent.error });
        campaigns.releaseFollowUpClaim(campaign.id);
        idempotency.mark(dedupeKey, { sent: false, error: sent.error });
      }
      results.push({ campaignId: campaign.id, result: sent });
    }
  }

  metrics.increment("worker.followup_check.runs");
  return results;
}

module.exports = { run };
