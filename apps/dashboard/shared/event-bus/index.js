/**
 * Lightweight in-process event bus.
 *
 * Provides pub/sub for domain events within a single process.
 * In production this would be backed by a durable message broker;
 * the interface stays the same.
 */

const { validateEvent } = require("../../contracts/v1/domain-events");

const listeners = new Map();
const eventLog = []; // In-memory event log for debugging/replay

function on(eventType, handler) {
  if (!listeners.has(eventType)) listeners.set(eventType, []);
  listeners.get(eventType).push(handler);
}

function off(eventType, handler) {
  if (!listeners.has(eventType)) return;
  const handlers = listeners.get(eventType).filter((h) => h !== handler);
  listeners.set(eventType, handlers);
}

async function emit(event) {
  const validation = validateEvent(event);
  if (!validation.valid) {
    console.error(`[event-bus] Invalid event ${event.type}:`, validation.errors);
    return { delivered: false, errors: validation.errors };
  }

  eventLog.push(event);

  const handlers = listeners.get(event.type) || [];
  const results = [];
  for (const handler of handlers) {
    try {
      await handler(event);
      results.push({ ok: true });
    } catch (err) {
      console.error(`[event-bus] Handler error for ${event.type}:`, err.message);
      results.push({ ok: false, error: err.message });
    }
  }
  return { delivered: true, handlerResults: results };
}

function getEventLog() {
  return [...eventLog];
}

function clearEventLog() {
  eventLog.length = 0;
}

function removeAllListeners() {
  listeners.clear();
}

module.exports = { on, off, emit, getEventLog, clearEventLog, removeAllListeners };
