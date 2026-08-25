const { mutate, readDb } = require("../core/db");
const { nowIso } = require("../../../shared/schemas");

function prune(events) {
  const now = Date.now();
  return events.filter((ts) => now - ts < 60 * 60 * 1000);
}

function checkAndTrack(limitName = "send") {
  const db = readDb();
  const perMinute = db.settings.rateLimits.perMinute;
  const perHour = db.settings.rateLimits.perHour;
  const now = Date.now();
  const events = prune(db.rateLimitEvents || []);
  const minuteCount = events.filter((ts) => now - ts < 60 * 1000).length;
  const hourCount = events.length;

  if (minuteCount >= perMinute) {
    return { allowed: false, reason: `Per-minute send guard hit (${perMinute})` };
  }
  if (hourCount >= perHour) {
    return { allowed: false, reason: `Per-hour send guard hit (${perHour})` };
  }

  mutate((next) => {
    next.rateLimitEvents = [...events, now];
    return next;
  });

  return { allowed: true, trackedAt: nowIso(), limitName };
}

function getSummary() {
  const db = readDb();
  const events = prune(db.rateLimitEvents || []);
  const now = Date.now();
  return {
    configured: db.settings.rateLimits,
    usedLastMinute: events.filter((ts) => now - ts < 60 * 1000).length,
    usedLastHour: events.length
  };
}

module.exports = { checkAndTrack, getSummary };
