async function ensureTable(db) {
  if (!db) return false;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS buddy_communication_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT,
      call_sid TEXT,
      stream_sid TEXT,
      event_type TEXT NOT NULL,
      role TEXT,
      text TEXT,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_buddy_events_contact ON buddy_communication_events(contact_id, created_at DESC)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_buddy_events_call ON buddy_communication_events(call_sid, created_at ASC)`).run();
  return true;
}

function eventText(event = {}) {
  return String(event.transcript || event.response || event.message || event.error || "").trim();
}

function eventRole(event = {}) {
  const type = String(event.type || "");
  if (type === "stt.transcript.final") return "customer";
  if (type.startsWith("buddy.") && event.response) return "buddy";
  return "system";
}

function shouldPersist(event = {}) {
  const type = String(event.type || "");
  if (!type) return false;
  if (type === "buddy.audio.mark" || type === "stt.connected" || type === "stt.utterance.end" || type === "stt.speech.started") return false;
  if (type.startsWith("stream.media.")) return type === "stream.media.stopped";
  return true;
}

async function record(db, event = {}) {
  if (!db || !shouldPersist(event)) return false;
  await ensureTable(db);
  await db.prepare(`
    INSERT INTO buddy_communication_events
      (contact_id, call_sid, stream_sid, event_type, role, text, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    String(event.contactId || ""),
    String(event.callSid || ""),
    String(event.streamSid || ""),
    String(event.type || "event"),
    eventRole(event),
    eventText(event),
    JSON.stringify(event),
    Number(event.ts || Date.now()),
  ).run();
  return true;
}

async function list(db, { contactId = "", limit = 1000 } = {}) {
  if (!db) return [];
  await ensureTable(db);
  const max = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const result = contactId
    ? await db.prepare(`SELECT * FROM buddy_communication_events WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?`).bind(String(contactId), max).all()
    : await db.prepare(`SELECT * FROM buddy_communication_events ORDER BY created_at DESC LIMIT ?`).bind(max).all();
  return (result.results || []).map(row => ({
    id: row.id,
    contactId: row.contact_id || "",
    callSid: row.call_sid || "",
    streamSid: row.stream_sid || "",
    type: row.event_type || "",
    role: row.role || "system",
    text: row.text || "",
    createdAt: Number(row.created_at || 0),
    payload: (() => { try { return JSON.parse(row.payload_json || "{}"); } catch { return {}; } })(),
  }));
}

async function conversations(db, { contactId = "", limit = 1000 } = {}) {
  const rows = await list(db, { contactId, limit });
  const calls = new Map();
  for (const row of [...rows].reverse()) {
    const key = row.callSid || `contact:${row.contactId || "unknown"}`;
    if (!calls.has(key)) calls.set(key, { callSid:row.callSid, contactId:row.contactId, startedAt:row.createdAt, endedAt:row.createdAt, events:[], transcript:[] });
    const call = calls.get(key);
    call.startedAt = Math.min(call.startedAt || row.createdAt, row.createdAt);
    call.endedAt = Math.max(call.endedAt || row.createdAt, row.createdAt);
    call.events.push(row);
    if ((row.role === "customer" || row.role === "buddy") && row.text) call.transcript.push({ role:row.role, text:row.text, at:row.createdAt, type:row.type });
  }
  return [...calls.values()].sort((a,b)=>b.endedAt-a.endedAt);
}

module.exports = { ensureTable, record, list, conversations };
