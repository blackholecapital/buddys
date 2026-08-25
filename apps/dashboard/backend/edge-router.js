/**
 * Edge-safe router.
 *
 * Uses the Web URL API instead of Node's url.parse().
 * Shared between Worker entrypoint and Node server.
 * Returns { fn, params } just like the original router,
 * but accepts a standard URL + method instead of a Node req.
 */

const dashboard = require("./functions/api/dashboard");
const orchestrator = require("./functions/api/orchestrator");
const systemStatus = require("./functions/api/system-status");
const contacts = require("./functions/api/contacts");
const leads = require("./functions/api/leads");
const calls = require("./functions/api/calls");
const callNow = require("./functions/api/call-now");
const templates = require("./functions/api/templates");
const campaigns = require("./functions/api/campaigns");
const inbox = require("./functions/api/inbox");
const activity = require("./functions/api/activity-log");
const settings = require("./functions/api/settings");
const compliance = require("./functions/api/compliance");
const roles = require("./functions/api/roles");
const automation = require("./functions/api/automation");
const rateLimits = require("./functions/api/rate-limits");
const webhooks = require("./functions/api/webhooks");
const health = require("./functions/api/health");
const conversationsHandler = require("./functions/api/conversations");
const reconciliation = require("./functions/api/reconciliation");
const buddyEvents = require("./functions/api/buddy-events");

function routeRequest(pathname, method, query = {}, headers = {}) {
  const parts = pathname.split("/").filter(Boolean);

  if (pathname === "/api/health") return { fn: health, params: { ...query } };
  if (pathname === "/api/reconciliation") return { fn: reconciliation, params: {} };

  if (parts[0] === "webhooks" && parts[1]) {
    return { fn: webhooks, params: { providerKey: parts[1], signature: query.sig || headers["x-twilio-signature"] || "" } };
  }

  if (pathname === "/api/buddy-events") return { fn: buddyEvents, params: { contactId: query.contactId || "", limit: query.limit || "1000" } };
  if (pathname === "/api/conversations") return { fn: conversationsHandler, params: {} };
  if (parts[0] === "api" && parts[1] === "conversations" && parts[2]) return { fn: conversationsHandler, params: { id: parts[2] } };

  if (pathname === "/api/leads") return { fn: leads, params:{} };
  if (pathname === "/api/calls") return { fn: calls, params:{} };
  if (pathname === "/api/call-now") return { fn: callNow, params:{ id:query.id || "", sig:query.sig || "" } };

  if (pathname === "/api/contacts") return { fn: contacts, params: {} };
  if (pathname === "/api/contacts/import") return { fn: contacts, params: { action: "import" } };
  if (parts[0] === "api" && parts[1] === "contacts" && parts[2]) return { fn: contacts, params: { id: parts[2] } };

  if (pathname === "/api/templates") return { fn: templates, params: {} };
  if (parts[0] === "api" && parts[1] === "templates" && parts[2]) return { fn: templates, params: { id: parts[2] } };

  if (pathname === "/api/campaigns") return { fn: campaigns, params: {} };
  if (pathname === "/api/campaigns/run") return { fn: campaigns, params: { action: "run" } };
  if (pathname === "/api/inbox") return { fn: inbox, params: {} };
  if (pathname === "/api/inbox/send") return { fn: inbox, params: { action: "send" } };
  if (pathname === "/api/inbox/reply") return { fn: inbox, params: { action: "reply" } };
  if (pathname === "/api/dashboard") return { fn: dashboard, params: {} };
  if (pathname === "/api/orchestrator") return { fn: orchestrator, params: {} };
  if (pathname === "/api/system-status") return { fn: systemStatus, params: {} };
  if (pathname === "/api/activity-log") return { fn: activity, params: {} };
  if (pathname === "/api/settings") return { fn: settings, params: {} };
  if (pathname === "/api/compliance/opt-out") return { fn: compliance, params: {} };
  if (pathname === "/api/roles") return { fn: roles, params: {} };
  if (pathname === "/api/automation/run-followups") return { fn: automation, params: {} };
  if (pathname === "/api/rate-limits") return { fn: rateLimits, params: {} };

  return null;
}

module.exports = { routeRequest };
