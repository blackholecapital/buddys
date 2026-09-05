function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(secret, contactId, sessionId) {
  if (!secret || !contactId || !sessionId) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${contactId}:${sessionId}`),
  )));
}

async function safeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    mismatch |= (a[index] || 0) ^ (b[index] || 0);
  }
  return mismatch === 0;
}

module.exports = { sign, safeEqual };

// Purpose-bound capability tokens. A contact version change revokes all its tokens.
async function issue(secret, contact, purpose, sessionId = "", now = Math.floor(Date.now()/1000)) {
  if (!secret || !contact?.id) return "";
  const ttl = purpose === "customer" ? 86400 : 7200;
  const claims={v:2,purpose,contactId:contact.id,sessionId,version:Number(contact.publicSessionVersion||0),iat:now,exp:now+ttl};
  const payload=base64url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${payload}.${await sign(secret,"buddy-capability-v2",payload)}`;
}
async function verify(secret, token, contact, purpose, sessionId = "", now = Math.floor(Date.now()/1000)) {
  if (!secret || !contact?.id || typeof token!=="string" || token.length>4096) return false;
  try {
    const parts=token.split('.'); if(parts.length!==2) return false;
    if(!await safeEqual(parts[1],await sign(secret,"buddy-capability-v2",parts[0]))) return false;
    const claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
    return claims.v===2 && claims.purpose===purpose && claims.contactId===contact.id && claims.sessionId===sessionId && claims.version===Number(contact.publicSessionVersion||0) && Number.isFinite(claims.iat) && claims.iat<=now && Number.isFinite(claims.exp) && claims.exp>now && claims.exp-claims.iat<=(purpose==='customer'?86400:7200);
  } catch { return false; }
}
module.exports.issue=issue;
module.exports.verify=verify;
