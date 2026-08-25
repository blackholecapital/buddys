/**
 * SendGrid Email Provider Adapter.
 *
 * Real provider-ready implementation. Requires SENDGRID_API_KEY
 * and SENDGRID_FROM_EMAIL env vars.
 */

const logger = require("../../../../shared/logger");
const env = require("../../../../shared/env");
const { id } = require("../../../../shared/schemas");

async function send({ to, subject, body }) {
  const apiKey = env.get("SENDGRID_API_KEY");
  const fromEmail = env.get("SENDGRID_FROM_EMAIL");

  if (!apiKey || !fromEmail) {
    logger.warn("SendGrid credentials not configured, cannot send", { to });
    return { ok: false, error: "SendGrid credentials not configured" };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail },
      subject: subject || "Follow-up",
      content: [{ type: "text/plain", value: body }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("SendGrid send failed", { status: response.status, body: errorBody });
    throw new Error(`SendGrid error ${response.status}: ${errorBody}`);
  }

  // SendGrid returns message ID in X-Message-Id header
  const messageId = response.headers.get("X-Message-Id") || id("sg");
  logger.info("SendGrid email sent", { messageId, to });

  return {
    ok: true,
    provider: "sendgrid",
    providerMessageId: messageId,
    to,
    subject,
    body,
  };
}

module.exports = { send };
