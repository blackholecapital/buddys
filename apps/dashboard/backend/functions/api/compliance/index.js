const compliance = require("../../../layers/domain/compliance");
module.exports = async function handler({ method, body }) {
  if (method === "POST") return { ok: true, data: compliance.optOut(body) };
  return { ok: false, error: "Unsupported compliance operation" };
};
