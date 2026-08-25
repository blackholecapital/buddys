const { conciergeGet } =
  require("../../../../shared/services/concierge.js");

module.exports = async ({ env }) => {
  return conciergeGet(env, "/api/health");
};
