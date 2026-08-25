/**
 * Provider selection.
 *
 * Routes to the correct SMS/email provider based on settings.
 * Supports mock (default), twilio (SMS), and sendgrid (email).
 */

const smsMock = require("../../../integrations/provider-adapters/sms/mock");
const emailMock = require("../../../integrations/provider-adapters/email/mock");
const logger = require("../../../shared/logger");

// Lazy-load real providers to avoid startup failures if deps missing
let twilioProvider = null;
let sendgridProvider = null;

function getProvider(channel, settings) {
  const providerKey = channel === "email"
    ? (settings?.providers?.email || "mock")
    : (settings?.providers?.sms || "mock");

  if (channel === "email") {
    if (providerKey === "sendgrid") {
      if (!sendgridProvider) {
        try {
          sendgridProvider = require("../../../integrations/provider-adapters/email/sendgrid");
        } catch (err) {
          logger.warn("SendGrid adapter load failed, falling back to mock", { error: err.message });
          return emailMock;
        }
      }
      return sendgridProvider;
    }
    return emailMock;
  }

  // SMS
  if (providerKey === "twilio") {
    if (!twilioProvider) {
      try {
        twilioProvider = require("../../../integrations/provider-adapters/sms/twilio");
      } catch (err) {
        logger.warn("Twilio adapter load failed, falling back to mock", { error: err.message });
        return smsMock;
      }
    }
    return twilioProvider;
  }
  return smsMock;
}

module.exports = { getProvider };
