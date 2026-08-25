const { ROLES } = require("../../../shared/schemas");
const { readDb } = require("../core/db");

function get() {
  const db = readDb();
  return {
    roles: ROLES,
    currentUser: db.users[0],
    permissions: {
      admin: ["contacts:write", "templates:write", "campaigns:write", "inbox:write", "settings:write"],
      agent: ["contacts:write", "templates:read", "campaigns:write", "inbox:write"],
      viewer: ["dashboard:read", "activity:read", "inbox:read"]
    }
  };
}

module.exports = { get };
