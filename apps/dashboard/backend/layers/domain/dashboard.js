const { readDb } = require("../core/db");

function getReadModel() {
  const db = readDb();
  const sent = db.messages.filter((m) => m.direction === "outbound").length;
  const replies = db.messages.filter((m) => m.direction === "inbound").length;
  const optedOut = db.contacts.filter((c) => c.optedOut).length;
  const scheduled = db.campaigns.filter((c) => c.status === "scheduled").length;
  return {
    totals: {
      contacts: db.contacts.length,
      templates: db.templates.length,
      campaigns: db.campaigns.length,
      scheduled,
      sent,
      replies,
      optedOut
    },
    recentActivity: db.activities.slice(0, 10),
    campaignStates: db.campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, scheduledAt: c.scheduledAt, sentAt: c.sentAt }))
  };
}

module.exports = { getReadModel };
