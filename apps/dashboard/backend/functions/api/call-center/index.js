const contacts = require("../../../layers/domain/contacts");
const { mergedContacts } = require("../contacts");

async function ensure(db) {
  if (!db) throw new Error("Call Center storage is not configured");
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS buddy_callbacks (
    contact_id TEXT PRIMARY KEY, due_at TEXT NOT NULL, note TEXT NOT NULL,
    status TEXT NOT NULL, version TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
  )`,
    )
    .run();
}

module.exports = async function handler({ method, body = {}, env, user }) {
  try {
    await ensure(env?.BUDDY_DB);
    const db = env.BUDDY_DB;
    if (method === "GET") {
      const rows = await db
        .prepare("SELECT * FROM buddy_callbacks ORDER BY due_at ASC")
        .all();
      return { ok: true, data: rows.results || [] };
    }
    if (method !== "POST")
      return { ok: false, error: "Unsupported Call Center operation" };
    if (body.action === "intake") {
      const firstName = String(body.firstName || "")
        .trim()
        .slice(0, 100);
      const phone = String(body.phone || "").replace(/[\s().-]/g, "");
      if (!firstName || !/^\+[1-9]\d{7,14}$/.test(phone))
        return {
          ok: false,
          error:
            "Enter a name and phone number with country code (for example +1…).",
        };
      const existing = (await mergedContacts(env)).find(
        (c) => String(c.phone || "").replace(/[\s().-]/g, "") === phone,
      );
      if (existing)
        return {
          ok: false,
          error:
            "This phone number already belongs to a lead. Search for the existing customer.",
        };
      const email = String(body.email || "")
        .trim()
        .slice(0, 254);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return { ok: false, error: "Enter a valid email address." };
      const data = contacts.create({
        firstName,
        lastName: String(body.lastName || "")
          .trim()
          .slice(0, 100),
        phone,
        email,
        interest: String(body.interest || "")
          .trim()
          .slice(0, 200),
        comments: String(body.comments || "")
          .trim()
          .slice(0, 2000),
        source: "Call Center intake",
        owner: user?.id || "",
        stage: "New Lead",
        smsConsent: false,
      });
      return { ok: true, data };
    }
    if (body.action !== "callback")
      return { ok: false, error: "Unknown Call Center action" };
    const contactId = String(body.contactId || "");
    if (!(await mergedContacts(env)).some((c) => c.id === contactId))
      return { ok: false, error: "Contact not found" };
    const status = body.status;
    if (!["scheduled", "completed", "cancelled"].includes(status))
      return { ok: false, error: "Invalid callback status" };
    const due = new Date(body.dueAt);
    if (
      !body.dueAt ||
      !Number.isFinite(due.getTime()) ||
      (status === "scheduled" && due.getTime() <= Date.now())
    )
      return { ok: false, error: "Choose a future callback time." };
    const note = String(body.note || "").trim();
    if (note.length > 2000)
      return { ok: false, error: "Notes must be 2,000 characters or fewer." };
    const version = crypto.randomUUID(),
      updated = new Date().toISOString();
    const args = [
      due.toISOString(),
      note,
      status,
      version,
      updated,
      user?.id || "operator",
    ];
    let result;
    if (body.version) {
      result = await db
        .prepare(
          `UPDATE buddy_callbacks SET due_at=?, note=?, status=?, version=?, updated_at=?, updated_by=? WHERE contact_id=? AND version=?`,
        )
        .bind(...args, contactId, String(body.version))
        .run();
    } else {
      if (status !== "scheduled")
        return { ok: false, error: "Refresh the callback before updating it." };
      result = await db
        .prepare(
          `INSERT OR IGNORE INTO buddy_callbacks (due_at,note,status,version,updated_at,updated_by,contact_id) VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(...args, contactId)
        .run();
    }
    if (result.meta?.changes !== 1)
      return {
        ok: false,
        error: "Another operator updated this callback. Refresh and try again.",
      };
    return {
      ok: true,
      data: {
        contact_id: contactId,
        due_at: due.toISOString(),
        note,
        status,
        version,
        updated_at: updated,
      },
    };
  } catch {
    return {
      ok: false,
      error: "Call Center data is unavailable. Refresh before trying again.",
    };
  }
};
