const templates = require("../../../layers/domain/templates");
module.exports = async function handler({ method, body, params }) {
  if (method === "GET") return { ok: true, data: templates.list() };
  if (method === "POST") return { ok: true, data: templates.create(body) };
  if (method === "PUT") return { ok: true, data: templates.update(params.id, body) };
  if (method === "DELETE") return { ok: true, data: templates.remove(params.id) };
  return { ok: false, error: "Unsupported templates operation" };
};
