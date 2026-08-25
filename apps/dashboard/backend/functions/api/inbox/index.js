const inbox = require("../../../layers/domain/inbox");
const compliance = require("../../../layers/domain/compliance");
module.exports = async function handler({ method, body }) {
  if (method === "GET") return { ok: true, data: inbox.list() };
  if (method === "POST" && body.mode === "reply") {
    if (compliance.detectStopWord(body.body)) {
      return { ok: true, data: { stopWordDetected: true, optOutCandidate: true } };
    }
    return { ok: true, data: inbox.receiveReply(body) };
  }
  if (method === "POST") return { ok: true, data: await inbox.send(body) };
  return { ok: false, error: "Unsupported inbox operation" };
};
