const contacts = require("../../../layers/domain/contacts");
const activity = require("../../../layers/domain/activity");
const { mergedContacts } = require("../contacts");
const { conciergePost } = require("../../../../shared/services/concierge");

module.exports = async function handler({ method, body, env }) {
  if (method !== "POST") return { ok: false, error: "POST only" };
  const contactId = String(body?.contactId || "").trim();
  if (!contactId) return { ok: false, error: "contactId required" };
  const contact = (await mergedContacts(env)).find((c) => c.id === contactId);
  if (!contact) return { ok: false, error: "Contact not found" };
  if (!contact.phone)
    return { ok: false, error: "Contact has no phone number" };
  if (contact.optedOut) return { ok: false, error: "Contact is opted out" };
  if (!env?.CONCIERGE || !env?.BUDDY_DB)
    return { ok: false, error: "Call service or storage is not configured" };
  const requestId = String(body?.requestId || crypto.randomUUID());
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))
    return { ok: false, error: "Invalid call request ID" };
  const db = env.BUDDY_DB;
  // Persist before making an external call. Repeated delivery of the same request
  // must never dial twice, including after an ambiguous provider/network failure.
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS buddy_operator_calls (
      request_id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, result_json TEXT, created_at INTEGER NOT NULL
    )`,
      )
      .run();
    const claim = await db
      .prepare(
        "INSERT OR IGNORE INTO buddy_operator_calls (request_id,contact_id,created_at) VALUES (?,?,?)",
      )
      .bind(requestId, contactId, Date.now())
      .run();
    if (claim.meta?.changes !== 1) {
      const prior = await db
        .prepare(
          "SELECT contact_id,result_json FROM buddy_operator_calls WHERE request_id=?",
        )
        .bind(requestId)
        .first();
      if (prior?.contact_id !== contactId)
        return { ok: false, error: "Call request belongs to another customer" };
      return prior?.result_json
        ? JSON.parse(prior.result_json)
        : {
            ok: false,
            error:
              "This call request is pending or unconfirmed. Check provider activity before retrying.",
          };
    }
  } catch {
    return {
      ok: false,
      error: "Call request storage is unavailable. No new call was requested.",
    };
  }
  let result;
  try {
    const concierge = await conciergePost(env, "/internal/calls", {
      contactId,
      contact,
      trigger: { type: "operator-dashboard", requestId },
    });
    const accepted = Boolean(
      concierge?.ok && concierge?.result?.ok && concierge?.result?.callSid,
    );
    result = accepted
      ? {
          ok: true,
          data: {
            callSid: concierge.result.callSid,
            status: concierge.result.status || "queued",
          },
        }
      : {
          ok: false,
          error:
            "Voice provider did not confirm the call. Check provider activity before retrying.",
        };
    if (accepted) {
      contacts.update(contact.id, { callStatus: "Call requested" });
      activity.record({
        type: "call.requested",
        entityType: "contact",
        entityId: contact.id,
        message: "Operator call request accepted",
        metadata: { requestId, callSid: concierge.result.callSid },
      });
    }
  } catch {
    result = {
      ok: false,
      error:
        "Call outcome is unconfirmed. Check provider activity before retrying.",
    };
  }
  // If saving fails, retain the unresolved claim so a retry cannot dial again.
  try {
    await db
      .prepare(
        "UPDATE buddy_operator_calls SET result_json=? WHERE request_id=?",
      )
      .bind(JSON.stringify(result), requestId)
      .run();
  } catch {}
  return result;
};
