const settings = require("../../../layers/domain/settings");
module.exports = async function handler({ method, body }) {
  if (method === "GET") return { ok: true, data: settings.get() };
  if (method === "PUT") return { ok: true, data: settings.update(body) };
  return { ok: false, error: "Unsupported settings operation" };
};
