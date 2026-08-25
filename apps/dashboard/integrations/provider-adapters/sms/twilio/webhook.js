/**
 * Twilio SMS Webhook Adapter.
 *
 * Edge-safe: uses Web Crypto API for HMAC-SHA1 verification.
 */

const { normalizeWebhookPayload, WEBHOOK_EVENT_TYPES } = require("../../../../contracts/v1/webhook-schemas");
const logger = require("../../../../shared/logger");
const env = require("../../../../shared/env");

function parse(rawBody) {
  const body = rawBody.Body || rawBody.body || "";
  const from = rawBody.From || rawBody.from || "";
  const to = rawBody.To || rawBody.to || "";
  const sid = rawBody.MessageSid || rawBody.messageSid || rawBody.providerMessageId || "";
  const isOptOut = rawBody.OptOutType === "STOP" || rawBody.optOutType === "STOP";

  return normalizeWebhookPayload({
    type: isOptOut ? WEBHOOK_EVENT_TYPES.OPT_OUT : WEBHOOK_EVENT_TYPES.INBOUND_MESSAGE,
    provider: "twilio",
    providerMessageId: sid,
    from, to, body,
    channel: "sms",
    rawPayload: rawBody,
  });
}

/**
 * Verify Twilio webhook signature using Web Crypto API (edge-safe).
 */
async function verify(rawBody, signature) {
  const authToken = env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) {
    logger.warn("Twilio auth token not set, skipping signature verification");
    return true;
  }
  if (!signature) return false;

  try {
    const sorted = Object.keys(rawBody).sort().reduce((acc, key) => acc + key + rawBody[key], "");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(authToken),
      { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(sorted));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

    // Constant-time comparison
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (err) {
    logger.error("Twilio signature verification error", { error: err.message });
    return false;
  }
}

module.exports = { parse, verify };
