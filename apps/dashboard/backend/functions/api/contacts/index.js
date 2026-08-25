const contacts = require("../../../layers/domain/contacts");

const STAGES = ["New Lead", "Contacted", "Engaged", "Docs Sent", "Scheduled", "Closed"];
const stageRank = (value) => Math.max(0, STAGES.indexOf(String(value || "New Lead")));

function furthestStage(...values) {
  return values.filter(Boolean).sort((a, b) => stageRank(b) - stageRank(a))[0] || "New Lead";
}

function inferStage(contact = {}) {
  if (String(contact.stage || "") === "Closed" || String(contact.deliveryStatus || "").toLowerCase() === "completed") return "Closed";
  if (contact.deliveryAt || String(contact.deliveryStatus || "").toLowerCase() === "scheduled") return "Scheduled";
  if (contact.docusignEnvelopeId || ["sent", "signed", "completed"].includes(String(contact.documentStatus || "").toLowerCase())) return "Docs Sent";
  if (contact._buddyEngaged || contact.selectedProduct) return "Engaged";

  const call = String(contact.callStatus || "").toLowerCase();
  if (call.includes("completed") || call.includes("in-progress") || call.includes("in progress") || call.includes("answered") || call.includes("connected")) return "Engaged";
  if (contact._buddyContacted || contact.outreachStatus === "Sent") return "Contacted";
  if (call.includes("requested") || call.includes("ringing") || call.includes("initiated")) return "Contacted";
  return contact.stage || "New Lead";
}

function hydrate(row) {
  let data = {};
  try { data = JSON.parse(row.contact_json || "{}"); } catch {}
  return { ...data, id:data.id || row.contact_id, _buddyUpdatedAt:Number(row.updated_at || 0) };
}

async function buddyStates(env) {
  if (!env?.BUDDY_DB) return [];
  try {
    await env.BUDDY_DB.prepare(`
      CREATE TABLE IF NOT EXISTS buddy_contacts (
        contact_id TEXT PRIMARY KEY,
        phone TEXT,
        contact_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();
    await env.BUDDY_DB.prepare(`
      CREATE TABLE IF NOT EXISTS buddy_sms_sessions (
        phone TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        contact_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();

    const [contactsRows, legacyRows] = await Promise.all([
      env.BUDDY_DB.prepare(`SELECT contact_id, contact_json, updated_at FROM buddy_contacts ORDER BY updated_at DESC`).all(),
      env.BUDDY_DB.prepare(`SELECT contact_id, contact_json, updated_at FROM buddy_sms_sessions ORDER BY updated_at DESC`).all(),
    ]);

    const byId = new Map();
    for (const row of legacyRows.results || []) byId.set(row.contact_id, hydrate(row));
    for (const row of contactsRows.results || []) {
      const next = hydrate(row);
      const prior = byId.get(row.contact_id);
      if (!prior || Number(next._buddyUpdatedAt || 0) >= Number(prior._buddyUpdatedAt || 0)) byId.set(row.contact_id, next);
    }
    return [...byId.values()];
  } catch (error) {
    console.error("Buddy dashboard state lookup failed", error);
    return [];
  }
}

async function workflowFacts(env) {
  const facts = new Map();
  if (!env?.BUDDY_DB) return facts;
  try {
    const result = await env.BUDDY_DB.prepare(`
      SELECT contact_id, event_type, payload_json, created_at
      FROM buddy_communication_events
      WHERE contact_id IS NOT NULL AND contact_id <> ''
      ORDER BY created_at ASC
      LIMIT 10000
    `).all();

    for (const row of result.results || []) {
      const id = String(row.contact_id || "");
      if (!id) continue;
      const fact = facts.get(id) || { contacted:false, engaged:false, latestCallStatus:"", updatedAt:0 };
      const type = String(row.event_type || "").toLowerCase();

      if (
        type === "call.requested" || type === "call.created" ||
        type === "call.initiated" || type === "call.ringing" ||
        type === "sms.reply"
      ) fact.contacted = true;

      if (
        type === "call.answered" || type === "call.in-progress" || type === "call.completed" ||
        type === "stt.transcript.final" || type === "buddy.turn.started" ||
        type.startsWith("buddy.product.") || type.startsWith("buddy.delivery.") ||
        type === "stream.media.stopped"
      ) {
        fact.contacted = true;
        fact.engaged = true;
      }

      if (type.startsWith("call.")) {
        fact.latestCallStatus = type.slice(5).replaceAll("-", " ");
      }
      fact.updatedAt = Math.max(fact.updatedAt, Number(row.created_at || 0));
      facts.set(id, fact);
    }
  } catch (error) {
    // Old databases may not have the event table yet. Contact data still works without it.
    console.warn("Buddy workflow event facts unavailable", error?.message || error);
  }
  return facts;
}

async function mergedContacts(env) {
  const base = contacts.list();
  const [live, facts] = await Promise.all([buddyStates(env), workflowFacts(env)]);
  const byId = new Map(base.map(row => [row.id, { ...row, _dashboardStage:row.stage || "New Lead" }]));

  for (const state of live) {
    const baseRow = byId.get(state.id) || {};
    const merged = { ...baseRow, ...state };
    merged._dashboardStage = baseRow._dashboardStage || baseRow.stage || "New Lead";
    byId.set(state.id, merged);
  }

  return [...byId.values()].map(row => {
    const fact = facts.get(row.id);
    const next = {
      ...row,
      _buddyContacted:Boolean(fact?.contacted),
      _buddyEngaged:Boolean(fact?.engaged),
    };
    if (fact?.engaged && (!next.callStatus || /not called|requested|ringing|initiated/i.test(next.callStatus))) {
      next.callStatus = "Call connected";
    } else if (fact?.latestCallStatus && (!next.callStatus || /not called/i.test(next.callStatus))) {
      next.callStatus = `Call ${fact.latestCallStatus}`;
    }
    next.stage = furthestStage(next._dashboardStage, next.stage, inferStage(next));
    return next;
  }).sort((a,b) => {
    const av = Number(a._buddyUpdatedAt || 0) || Date.parse(a.updatedAt || a.createdAt || 0) || 0;
    const bv = Number(b._buddyUpdatedAt || 0) || Date.parse(b.updatedAt || b.createdAt || 0) || 0;
    return bv - av;
  });
}

module.exports = async function handler({ method, body, params, env }) {
  if (method === "GET") return { ok:true, data:await mergedContacts(env) };
  if (method === "POST" && params.action === "import") return { ok:true, data:contacts.importStub(body.csv || body.rows || "") };
  if (method === "POST") return { ok:true, data:contacts.create(body) };
  if (method === "PUT") return { ok:true, data:contacts.update(params.id, body) };
  if (method === "DELETE") return { ok:true, data:contacts.remove(params.id) };
  return { ok:false, error:"Unsupported contacts operation" };
};
