const dashboard = require("../../../layers/domain/dashboard");
module.exports = async function handler() { return { ok: true, data: dashboard.getReadModel() }; };
