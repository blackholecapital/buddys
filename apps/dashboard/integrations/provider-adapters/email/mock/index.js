const { id } = require("../../../../shared/schemas");

async function send({ to, subject, body }) {
  return {
    ok: true,
    provider: "mock-email",
    providerMessageId: id("email"),
    to,
    subject: subject || "Follow-up",
    body
  };
}

module.exports = { send };
