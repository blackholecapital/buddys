const rateLimits = require("../../../layers/domain/rateLimits");
module.exports = async function handler() { return { ok: true, data: rateLimits.getSummary() }; };
