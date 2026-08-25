/**
 * Webhook Router.
 *
 * Routes incoming webhook requests to the correct provider adapter
 * based on path segments, then hands the normalized payload to the
 * webhook ingestion handler.
 */

const smsMockWebhook = require("./sms/mock/webhook");
const emailMockWebhook = require("./email/mock/webhook");
const logger = require("../../shared/logger");

// Lazy-load real provider webhooks
let twilioWebhook = null;
let sendgridWebhook = null;

const adapters = {
  "sms-mock": smsMockWebhook,
  "email-mock": emailMockWebhook,
};

function getAdapter(providerKey) {
  // Check static adapters
  if (adapters[providerKey]) return adapters[providerKey];

  // Lazy-load real adapters
  if (providerKey === "sms-twilio") {
    if (!twilioWebhook) {
      try {
        twilioWebhook = require("./sms/twilio/webhook");
      } catch (err) {
        logger.warn("Twilio webhook adapter not available", { error: err.message });
        return null;
      }
    }
    return twilioWebhook;
  }

  if (providerKey === "email-sendgrid") {
    if (!sendgridWebhook) {
      try {
        sendgridWebhook = require("./email/sendgrid/webhook");
      } catch (err) {
        logger.warn("SendGrid webhook adapter not available", { error: err.message });
        return null;
      }
    }
    return sendgridWebhook;
  }

  return null;
}

function parseProviderFromPath(pathname) {
  const match = pathname.match(/^\/webhooks\/([a-z]+-[a-z]+)/);
  return match ? match[1] : null;
}

function listAdapters() {
  return ["sms-mock", "email-mock", "sms-twilio", "email-sendgrid"];
}

module.exports = { getAdapter, parseProviderFromPath, listAdapters };
