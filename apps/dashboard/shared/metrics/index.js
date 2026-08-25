/**
 * Metrics placeholder.
 *
 * Lightweight counters and gauges for operational visibility.
 * In production, pipe these to Prometheus/Datadog/CloudWatch.
 * For now, they accumulate in memory and are exposed via /api/health.
 */

const counters = {};
const gauges = {};

function increment(name, value = 1) {
  counters[name] = (counters[name] || 0) + value;
}

function gauge(name, value) {
  gauges[name] = value;
}

function getAll() {
  return {
    counters: { ...counters },
    gauges: { ...gauges },
  };
}

function reset() {
  for (const key of Object.keys(counters)) delete counters[key];
  for (const key of Object.keys(gauges)) delete gauges[key];
}

module.exports = { increment, gauge, getAll, reset };
