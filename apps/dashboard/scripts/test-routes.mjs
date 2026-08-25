import { routeRequest } from "../backend/edge-router.js";

const tests = [
  "/api/health",
  "/api/dashboard",
  "/api/activity-log",
  "/api/conversations",
  "/api/contacts",
  "/api/campaigns",
  "/api/inbox",
  "/api/settings",
];

for (const path of tests) {
  const match = routeRequest(path, "GET", {}, {});
  console.log(path, "=>", match ? "FOUND" : "MISSING");
}
