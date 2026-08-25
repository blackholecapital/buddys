const roles = require("../../../layers/domain/roles");
module.exports = async function handler() { return { ok: true, data: roles.get() }; };
