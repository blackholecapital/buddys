import { routeRequest } from "../backend/edge-router.js";

const tests = [
  { method:"GET", path:"/api/health" },
  { method:"GET", path:"/api/dashboard" },
  { method:"GET", path:"/api/activity-log" },
  { method:"GET", path:"/api/conversations" },
  { method:"GET", path:"/api/contacts" },
  { method:"GET", path:"/api/campaigns" },
  { method:"GET", path:"/api/inbox" },
  { method:"GET", path:"/api/settings" },
  { method:"POST", path:"/api/leads" },
  { method:"POST", path:"/api/video/session" },
];

let missing = 0;
for (const test of tests) {
  const match = routeRequest(test.path, test.method, {}, {});
  console.log(`${test.method} ${test.path} => ${match ? "FOUND" : "MISSING"}`);
  if (!match) missing += 1;
}

if (missing) process.exitCode = 1;
