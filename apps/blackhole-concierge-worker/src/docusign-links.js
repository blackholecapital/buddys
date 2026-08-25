function randomToken(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function ensureTable(env) {
  if (!env.DB) throw new Error("D1 database binding is not configured");
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS buddy_docusign_links (
      token TEXT PRIMARY KEY,
      target_url TEXT NOT NULL,
      contact_id TEXT,
      envelope_id TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
}

export async function createSigningShortLink(env, { targetUrl, contactId = "", envelopeId = "" } = {}) {
  if (!targetUrl) throw new Error("DocuSign signing target URL is required");
  await ensureTable(env);
  const token = randomToken(14);
  await env.DB.prepare(`
    INSERT INTO buddy_docusign_links (token, target_url, contact_id, envelope_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(token, String(targetUrl), String(contactId), String(envelopeId), Date.now()).run();
  const base = String(env.PUBLIC_BASE_URL || "https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev").replace(/\/$/, "");
  return `${base}/docusign/sign/${token}`;
}

export async function resolveSigningShortLink(env, token) {
  if (!token) return null;
  await ensureTable(env);
  return await env.DB.prepare(`
    SELECT token, target_url, contact_id, envelope_id, created_at
    FROM buddy_docusign_links
    WHERE token = ?
    LIMIT 1
  `).bind(String(token)).first();
}
