function normalizePhone(value = "") {
  return String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

async function ensureTable(env) {
  if (!env.DB) return false;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS buddy_sms_sessions (
      phone TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      contact_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS buddy_contacts (
      contact_id TEXT PRIMARY KEY,
      phone TEXT,
      contact_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_buddy_contacts_phone ON buddy_contacts(phone, updated_at DESC)`).run();
  return true;
}

function hydrate(row, fallbackPhone = "") {
  if (!row) return null;
  try {
    const contact = JSON.parse(row.contact_json || "{}");
    return { ...contact, id:contact.id || row.contact_id, _smsSessionUpdatedAt:row.updated_at };
  } catch {
    return { id:row.contact_id, phone:fallbackPhone || row.phone || "", _smsSessionUpdatedAt:row.updated_at };
  }
}

export async function rememberSmsContact(env, contact = {}) {
  const phone = normalizePhone(contact.phone);
  if (!contact.id || !env.DB) return false;
  await ensureTable(env);
  const now = Date.now();
  const json = JSON.stringify(contact);

  await env.DB.prepare(`
    INSERT INTO buddy_contacts (contact_id, phone, contact_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(contact_id) DO UPDATE SET
      phone = excluded.phone,
      contact_json = excluded.contact_json,
      updated_at = excluded.updated_at
  `).bind(String(contact.id), phone, json, now).run();

  if (phone) {
    await env.DB.prepare(`
      INSERT INTO buddy_sms_sessions (phone, contact_id, contact_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        contact_id = excluded.contact_id,
        contact_json = excluded.contact_json,
        updated_at = excluded.updated_at
    `).bind(phone, String(contact.id), json, now).run();
  }
  return true;
}

export async function getSmsContact(env, phoneValue) {
  const phone = normalizePhone(phoneValue);
  if (!phone || !env.DB) return null;
  await ensureTable(env);
  const row = await env.DB.prepare(`
    SELECT contact_id, contact_json, updated_at
    FROM buddy_sms_sessions
    WHERE phone = ?
    LIMIT 1
  `).bind(phone).first();
  return hydrate(row, phoneValue);
}

export async function getSmsContactById(env, contactId) {
  if (!contactId || !env.DB) return null;
  await ensureTable(env);
  let row = await env.DB.prepare(`
    SELECT contact_id, phone, contact_json, updated_at
    FROM buddy_contacts
    WHERE contact_id = ?
    LIMIT 1
  `).bind(String(contactId)).first();
  if (!row) {
    row = await env.DB.prepare(`
      SELECT contact_id, phone, contact_json, updated_at
      FROM buddy_sms_sessions
      WHERE contact_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(String(contactId)).first();
  }
  return hydrate(row);
}

export async function listSmsContacts(env, limit = 1000) {
  if (!env.DB) return [];
  await ensureTable(env);
  const result = await env.DB.prepare(`
    SELECT contact_id, phone, contact_json, updated_at
    FROM buddy_contacts
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(Math.min(Math.max(Number(limit) || 1000, 1), 5000)).all();
  return (result.results || []).map(row => hydrate(row)).filter(Boolean);
}
