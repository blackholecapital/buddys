const activity = require("../../../layers/domain/activity");
module.exports = async function handler() { return { ok: true, data: activity.list() }; };
