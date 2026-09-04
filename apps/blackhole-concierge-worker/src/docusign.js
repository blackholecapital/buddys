import { buildDemoEnvelope } from "./demo-agreement.js";

let tokenCache = { token: "", expiresAt: 0 };

function basePath(env) {
  return String(env.DOCUSIGN_BASE_PATH || "https://demo.docusign.net/restapi").replace(/\/$/, "");
}

function oauthHost(env) {
  return String(env.DOCUSIGN_OAUTH_HOST || "account-d.docusign.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function base64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizePem(value) {
  let text = String(value || "").trim();

  // Wrangler secrets are sometimes pasted as a quoted JSON-style string or with literal \n sequences.
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  text = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  return text;
}

function extractPemBytes(pemValue, label) {
  const pem = normalizePem(pemValue);
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const start = pem.indexOf(begin);
  const finish = pem.indexOf(end);

  if (start < 0 || finish < 0 || finish <= start) return null;

  const body = pem
    .slice(start + begin.length, finish)
    .replace(/\s+/g, "");

  if (!body) throw new Error(`DOCUSIGN_RSA_PRIVATE_KEY ${label} body is empty`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) {
    throw new Error(`DOCUSIGN_RSA_PRIVATE_KEY ${label} body is not valid base64`);
  }

  let binary;
  try {
    binary = atob(body);
  } catch {
    throw new Error(`DOCUSIGN_RSA_PRIVATE_KEY ${label} body could not be base64-decoded`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function derLength(length) {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag, content) {
  const body = content instanceof Uint8Array ? content : new Uint8Array(content);
  const len = derLength(body.length);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pkcs1ToPkcs8(pkcs1) {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);
  return der(0x30, concatBytes(version, rsaAlgorithmIdentifier, der(0x04, pkcs1)));
}

function pemToPkcs8ArrayBuffer(pemValue) {
  const pkcs8 = extractPemBytes(pemValue, "PRIVATE KEY");
  if (pkcs8) return pkcs8.buffer;

  const pkcs1 = extractPemBytes(pemValue, "RSA PRIVATE KEY");
  if (pkcs1) return pkcs1ToPkcs8(pkcs1).buffer;

  throw new Error(
    "DOCUSIGN_RSA_PRIVATE_KEY must contain a complete PKCS#8 PRIVATE KEY or PKCS#1 RSA PRIVATE KEY PEM block"
  );
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }

  if (!response.ok) {
    const detail = data?.error_description || data?.message || data?.errorCode || data?.error || text || `HTTP ${response.status}`;
    const err = new Error(`DocuSign request failed (${response.status}): ${detail}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

export function docusignConfigured(env) {
  return Boolean(
    env.DOCUSIGN_INTEGRATION_KEY &&
    env.DOCUSIGN_USER_ID &&
    env.DOCUSIGN_RSA_PRIVATE_KEY &&
    env.DOCUSIGN_ACCOUNT_ID
  );
}

export function docusignConsentUrl(env) {
  const clientId = String(env.DOCUSIGN_INTEGRATION_KEY || "");
  const redirectUri = String(
    env.DOCUSIGN_CONSENT_REDIRECT_URI || env.PUBLIC_BASE_URL || "https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev"
  ).replace(/\/$/, "") + "/docusign/consent-complete";

  const qs = new URLSearchParams({
    response_type:"code",
    scope:"signature impersonation",
    client_id:clientId,
    redirect_uri:redirectUri,
  });

  return `https://${oauthHost(env)}/oauth/auth?${qs.toString()}`;
}

async function createJwtAssertion(env) {
  const integrationKey = String(env.DOCUSIGN_INTEGRATION_KEY || "");
  const userId = String(env.DOCUSIGN_USER_ID || "");
  const now = Math.floor(Date.now() / 1000);

  const header = { alg:"RS256", typ:"JWT" };
  const payload = {
    iss:integrationKey,
    sub:userId,
    aud:oauthHost(env),
    iat:now,
    exp:now + 3600,
    scope:"signature impersonation",
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;

  let key;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8ArrayBuffer(env.DOCUSIGN_RSA_PRIVATE_KEY),
      { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw new Error(`DocuSign RSA private key import failed: ${error?.message || String(error)}`);
  }

  const signature = await crypto.subtle.sign(
    { name:"RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export async function getDocusignAccessToken(env, force = false) {
  if (!docusignConfigured(env)) {
    throw new Error("DocuSign JWT is not configured: set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_RSA_PRIVATE_KEY, and DOCUSIGN_ACCOUNT_ID");
  }

  if (!force && tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const assertion = await createJwtAssertion(env);
  let token;

  try {
    token = await jsonRequest(`https://${oauthHost(env)}/oauth/token`, {
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded" },
      body:new URLSearchParams({
        grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
  } catch (error) {
    if (String(error?.data?.error || "") === "consent_required") {
      const wrapped = new Error("DocuSign consent_required");
      wrapped.code = "consent_required";
      wrapped.consentUrl = docusignConsentUrl(env);
      throw wrapped;
    }
    throw error;
  }

  if (!token.access_token) throw new Error("DocuSign OAuth did not return an access token");

  tokenCache = {
    token:token.access_token,
    expiresAt:Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000,
  };

  return tokenCache.token;
}

async function authHeaders(env) {
  return {
    Authorization:`Bearer ${await getDocusignAccessToken(env)}`,
    "Content-Type":"application/json",
  };
}

export async function createBuddySigningSession(env, {
  contact = {},
  product = {},
  selectionNumber = 1,
  contactId = "",
} = {}) {
  if (!docusignConfigured(env)) throw new Error("DocuSign JWT is not configured");
  if (!contact.email) throw new Error("Customer email is required for the DocuSign signer identity");

  const accountId = String(env.DOCUSIGN_ACCOUNT_ID);
  const clientUserId = `buddy-${contactId || contact.id || Date.now()}`;
  const agreementId = `BUDDY-DEMO-${Date.now()}`;
  const publicBase = String(
    env.PUBLIC_BASE_URL || "https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev"
  ).replace(/\/$/, "");
  const connectUrl = `${publicBase}/docusign/connect?contactId=${encodeURIComponent(contactId || contact.id || "")}`;

  const envelope = buildDemoEnvelope({ contact, product, selectionNumber, agreementId });
  const signer = envelope?.recipients?.signers?.[0];
  if (!signer) throw new Error("Buddy demo envelope is missing a signer");

  signer.clientUserId = clientUserId;
  envelope.eventNotification.url = connectUrl;
  envelope.eventNotification.includeHMAC = "true";
  envelope.eventNotification.eventData = {
    version:"restv2.1",
    format:"json",
    includeData:["recipients"],
  };

  const created = await jsonRequest(
    `${basePath(env)}/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes`,
    {
      method:"POST",
      headers:await authHeaders(env),
      body:JSON.stringify(envelope),
    },
  );

  const envelopeId = created.envelopeId;
  if (!envelopeId) throw new Error("DocuSign did not return an envelopeId");

  const returnUrl = `${String(env.DOCUSIGN_RETURN_URL || publicBase).replace(/\/$/, "")}/docusign/return?contactId=${encodeURIComponent(contactId || contact.id || "")}&envelopeId=${encodeURIComponent(envelopeId)}`;

  const recipientView = await jsonRequest(
    `${basePath(env)}/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(envelopeId)}/views/recipient`,
    {
      method:"POST",
      headers:await authHeaders(env),
      body:JSON.stringify({
        returnUrl,
        authenticationMethod:"none",
        email:contact.email,
        userName:`${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Customer",
        clientUserId,
      }),
    },
  );

  if (!recipientView.url) throw new Error("DocuSign did not return a recipient signing URL");

  return {
    ok:true,
    agreementId,
    envelopeId,
    signingUrl:recipientView.url,
    status:created.status || "sent",
    productName:product.name || "",
  };
}
