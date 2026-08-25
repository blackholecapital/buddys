const { readDb } = require("../../backend/layers/core/db");
require("../../backend/server").start(0).then((server) => {
  console.log("Seeded database with", readDb().contacts.length, "contacts and", readDb().templates.length, "templates");
  server.close();
});
