const { id } = require("../../../../shared/schemas");

async function send({ to, body }) {
  return {
    ok: true,
    provider: "mock-sms",
    providerMessageId: id("sms"),
    to,
    body
  };
}

module.exports = { send };
