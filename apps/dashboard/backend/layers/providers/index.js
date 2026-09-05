const env = require("../../../shared/env");
const smsMock = require("../../../integrations/provider-adapters/sms/mock");
const emailMock = require("../../../integrations/provider-adapters/email/mock");
function getProvider(channel, settings) {
  if (!["sms","email"].includes(channel)) throw new Error("Unsupported message channel");
  const provider = settings?.providers?.[channel] || "mock";
  if (provider === "mock" && !env.isProduction()) return channel === "sms" ? smsMock : emailMock;
  if (channel === "sms" && provider === "twilio") return require("../../../integrations/provider-adapters/sms/twilio");
  if (channel === "email" && provider === "sendgrid") return require("../../../integrations/provider-adapters/email/sendgrid");
  throw new Error(`Configure a real ${channel} provider before sending (${provider} is unavailable)`);
}
module.exports = { getProvider };
