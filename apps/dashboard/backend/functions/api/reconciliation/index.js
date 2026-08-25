/**
 * Reconciliation Reporting endpoint.
 *
 * Provides operational reports for identifying inconsistencies:
 * - Messages in "queued" state older than threshold
 * - Campaigns in "scheduled" state past their scheduledAt
 * - Contacts opted-out but still in active campaigns
 * - DLQ items awaiting reprocessing
 * - Conversations with orphaned messages
 */

const { readDb } = require("../../../layers/core/db");
const { getDlq } = require("../../../../shared/retry");
const logger = require("../../../../shared/logger");

module.exports = async function handler({ method }) {
  if (method !== "GET") return { ok: false, error: "GET only" };

  const db = readDb();
  const now = Date.now();

  // Stale queued messages (older than 5 minutes)
  const staleMessages = db.messages.filter(
    (m) => m.status === "queued" && (now - new Date(m.createdAt).getTime()) > 5 * 60 * 1000
  );

  // Overdue campaigns (scheduled in the past but not yet sent)
  const overdueCampaigns = db.campaigns.filter(
    (c) => c.status === "scheduled" && new Date(c.scheduledAt).getTime() < now
  );

  // Opted-out contacts still referenced in unsent campaigns
  const optedOutIds = new Set(db.contacts.filter((c) => c.optedOut).map((c) => c.id));
  const conflictCampaigns = db.campaigns.filter(
    (c) => c.status === "scheduled" && optedOutIds.has(c.contactId)
  );

  // Failed messages in DLQ
  const dlqItems = getDlq();

  // Messages without conversations
  const convIds = new Set((db.conversations || []).map((c) => c.id));
  const orphanedMessages = db.messages.filter(
    (m) => m.conversationId && !convIds.has(m.conversationId)
  );

  // Failed campaigns
  const failedCampaigns = db.campaigns.filter((c) => c.status === "failed");

  const report = {
    generatedAt: new Date().toISOString(),
    staleMessages: { count: staleMessages.length, items: staleMessages.map((m) => ({ id: m.id, status: m.status, createdAt: m.createdAt })) },
    overdueCampaigns: { count: overdueCampaigns.length, items: overdueCampaigns.map((c) => ({ id: c.id, name: c.name, scheduledAt: c.scheduledAt })) },
    conflictCampaigns: { count: conflictCampaigns.length, items: conflictCampaigns.map((c) => ({ id: c.id, contactId: c.contactId })) },
    failedCampaigns: { count: failedCampaigns.length, items: failedCampaigns.map((c) => ({ id: c.id, name: c.name, reason: c.failureReason })) },
    dlq: { count: dlqItems.length, items: dlqItems },
    orphanedMessages: { count: orphanedMessages.length, ids: orphanedMessages.map((m) => m.id) },
  };

  logger.info("Reconciliation report generated", {
    stale: report.staleMessages.count,
    overdue: report.overdueCampaigns.count,
    conflicts: report.conflictCampaigns.count,
    dlq: report.dlq.count,
  });

  return { ok: true, data: report };
};
