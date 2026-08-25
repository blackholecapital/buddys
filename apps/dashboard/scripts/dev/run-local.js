const { start } = require("../../backend/server");
start(process.env.PORT || 3000).then(() => {
  console.log("Local dev server started");
});
