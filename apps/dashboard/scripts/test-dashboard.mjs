import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const dashboard = require("../backend/functions/api/dashboard");

console.dir(dashboard, { depth: 2 });
