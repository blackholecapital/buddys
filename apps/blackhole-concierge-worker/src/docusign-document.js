import { getDocusignAccessToken } from "./docusign.js";

function basePath(env) {
  return String(env.DOCUSIGN_BASE_PATH || "https://demo.docusign.net/restapi").replace(/\/$/, "");
}

export async function fetchSignedEnvelopePdf(env, envelopeId) {
  if (!envelopeId) throw new Error("DocuSign envelope id is required");
  const accountId = String(env.DOCUSIGN_ACCOUNT_ID || "");
  if (!accountId) throw new Error("DocuSign account id is not configured");
  const token = await getDocusignAccessToken(env);
  const response = await fetch(
    `${basePath(env)}/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(envelopeId)}/documents/combined`,
    { headers:{ Authorization:`Bearer ${token}`, Accept:"application/pdf" } },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`DocuSign signed document request failed (${response.status}): ${text.slice(0,240)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
