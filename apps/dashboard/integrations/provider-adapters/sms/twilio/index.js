/**
 * Twilio SMS Provider Adapter.
 *
 * Real provider-ready implementation. Requires TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER env vars.
 * Falls back to mock if credentials are missing.
 */

const logger = require("../../../../shared/logger");
const env = require("../../../../shared/env");

async function send({ to, body }) {
  const accountSid = env.get("TWILIO_ACCOUNT_SID");
  const authToken = env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = env.get("TWILIO_FROM_NUMBER");

  if (!accountSid || !authToken || !fromNumber) {
    logger.warn("Twilio credentials not configured, cannot send", { to });
    return { ok: false, error: "Twilio credentials not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const result = await response.json();

  if (!response.ok) {
    logger.error("Twilio send failed", { status: response.status, code: result.code, message: result.message });
    throw new Error(`Twilio error ${result.code}: ${result.message}`);
  }

  logger.info("Twilio SMS sent", { sid: result.sid, to });
  return {
    ok: true,
    provider: "twilio",
    providerMessageId: result.sid,
    to,
    body,
  };
}

module.exports = { send };
