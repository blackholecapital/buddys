const { readDb } = require("../../../backend/layers/core/db");
const campaigns = require("../../../backend/layers/domain/campaigns");
const inbox = require("../../../backend/layers/domain/inbox");
const idempotency = require("../../../shared/idempotency");
const metrics = require("../../../shared/metrics");
const logger = require("../../../shared/logger");

async function run() {
  const db = readDb();
  const due = db.campaigns.filter((c) => c.status === "scheduled" && new Date(c.scheduledAt).getTime() <= Date.now());
  const results = [];

  for (const campaign of due) {
    const claimed = campaigns.claimScheduledForSend(campaign.id);
    if (!claimed) {
      logger.warn("Campaign send skipped: claim unavailable", { campaignId: campaign.id });
      results.push({ campaignId: campaign.id, skipped: true, reason: "already-claimed" });
      continue;
    }

    // Idempotency: skip if this campaign send was already processed
    const dedupeKey = idempotency.makeKey("campaign-send", campaign.id);
    const existing = idempotency.check(dedupeKey);
    if (existing.duplicate) {
      logger.info("Campaign send reused cached result", { campaignId: campaign.id, sent: Boolean(existing.result?.sent) });
      if (existing.result?.sent) campaigns.markSent(campaign.id);
      else campaigns.markFailed(campaign.id, existing.result?.error || "Cached send failure");
      results.push({ campaignId: campaign.id, result: existing.result, skipped: true });
      continue;
    }

    const sent = await inbox.send({
      contactId: campaign.contactId,
      campaignId: campaign.id,
      templateId: campaign.templateId,
      channel: campaign.channel,
      automationStep: "initial",
      idempotencyKey: idempotency.makeKey("send", campaign.contactId, campaign.id, campaign.templateId, "initial"),
    });

    if (!sent.error) {
      logger.info("Campaign send success", { campaignId: campaign.id, messageId: sent.id });
      campaigns.markSent(campaign.id);
      idempotency.mark(dedupeKey, { sent: true, messageId: sent.id });
    } else {
      logger.error("Campaign send failed", { campaignId: campaign.id, error: sent.error });
      campaigns.markFailed(campaign.id, sent.error);
      idempotency.mark(dedupeKey, { sent: false, error: sent.error });
    }
    results.push({ campaignId: campaign.id, result: sent });
  }

  metrics.increment("worker.campaign_send.runs");
  return results;
}

module.exports = { run };
