/**
 * Centralized permissions enforcement.
 *
 * Provides middleware-style permission checks that can be used
 * across API handlers, worker jobs, and webhook paths.
 * Production uses verified Access identity; local tests retain explicit role fixtures.
 */

const { readDb } = require("../../backend/layers/core/db");
const logger = require("../logger");

const PERMISSION_MAP = {
  admin: [
    "contacts:read", "contacts:write",
    "templates:read", "templates:write",
    "campaigns:read", "campaigns:write",
    "inbox:read", "inbox:write",
    "settings:read", "settings:write",
    "dashboard:read", "activity:read",
    "compliance:write", "webhooks:write",
  ],
  agent: [
    "contacts:read", "contacts:write",
    "templates:read",
    "campaigns:read", "campaigns:write",
    "inbox:read", "inbox:write",
    "dashboard:read", "activity:read",
    "compliance:write",
  ],
  viewer: [
    "contacts:read", "templates:read", "campaigns:read",
    "inbox:read", "dashboard:read", "activity:read",
  ],
};

/**
 * Route → required permission mapping.
 */
const ROUTE_PERMISSIONS = {
  "POST /api/calls": "contacts:write",
  "GET /api/dashboard": "dashboard:read",
  "GET /api/orchestrator": "dashboard:read",
  "GET /api/system-status": "dashboard:read",
  "GET /api/contacts": "contacts:read",
  "POST /api/contacts": "contacts:write",
  "PUT /api/contacts": "contacts:write",
  "DELETE /api/contacts": "contacts:write",
  "POST /api/contacts/import": "contacts:write",
  "GET /api/templates": "templates:read",
  "POST /api/templates": "templates:write",
  "PUT /api/templates": "templates:write",
  "DELETE /api/templates": "templates:write",
  "GET /api/campaigns": "campaigns:read",
  "POST /api/campaigns": "campaigns:write",
  "POST /api/campaigns/run": "campaigns:write",
  "GET /api/inbox": "inbox:read",
  "POST /api/inbox/send": "inbox:write",
  "POST /api/inbox/reply": "inbox:write",
  "GET /api/conversations": "inbox:read",
  "GET /api/activity-log": "activity:read",
  "GET /api/settings": "settings:read",
  "PUT /api/settings": "settings:write",
  "POST /api/compliance/opt-out": "compliance:write",
  "GET /api/roles": "dashboard:read",
  "POST /api/automation/run-followups": "campaigns:write",
  "GET /api/rate-limits": "dashboard:read",
  "GET /api/health": null, // No auth required
  "POST /api/leads": null, // Public Buddy lead capture
  "GET /api/call-now": null, // Signed public callback URL
  "POST /api/video/session": null, // Public demo, guarded by server-side rate limits
  "POST /api/video/transcript": null, // Public session transcript, validated with the signed contact/session token
  "POST /api/video/action": null, // Signed public Buddy video workflow action
  "GET /api/buddy-events": "inbox:read",
  "GET /api/reconciliation": "settings:read",
  "POST /webhooks": "webhooks:write",
};

/**
 * Verify production Access identity; permit fixtures only in explicit local modes.
 */
async function resolveUser(headers = {}, config = {}) {
  if (!["test", "development"].includes(config.NODE_ENV || process.env.NODE_ENV)) {
    return require("../services/operator-auth").identity(headers, config);
  }
  const requestedRole = String(headers["x-user-role"] || headers["X-User-Role"] || "").trim().toLowerCase();
  if (requestedRole === "anonymous") return { id: "anonymous", role: "anonymous" };
  if (requestedRole && PERMISSION_MAP[requestedRole]) return { id: `header_${requestedRole}`, role: requestedRole };
  const db = readDb();
  return db.users[0] || { id: "anonymous", role: "viewer" };
}

/**
 * Check if a user has a specific permission.
 */
function hasPermission(user, permission) {
  if (!user || !user.role || user.role === "anonymous") return false;
  if (!permission) return true; // No permission required
  const perms = PERMISSION_MAP[user.role] || [];
  return perms.includes(permission);
}

/**
 * Resolve the required permission for a given method + path.
 * Normalizes dynamic path segments (e.g., /api/contacts/123 → /api/contacts).
 */
function resolvePermission(method, pathname) {
  // Try exact match first
  const exact = ROUTE_PERMISSIONS[`${method} ${pathname}`];
  if (exact !== undefined) return exact;

  // Normalize: strip trailing ID segments for CRUD routes
  const basePath = pathname.replace(/\/[a-zA-Z0-9_-]+$/, "");
  const baseMatch = ROUTE_PERMISSIONS[`${method} ${basePath}`];
  if (baseMatch !== undefined) return baseMatch;

  // Webhook routes
  if (pathname.startsWith("/webhooks/")) return ROUTE_PERMISSIONS["POST /webhooks"];

  return undefined; // Unknown route — deny by default
}

/**
 * Enforce permission for a request. Returns { allowed, user, error? }.
 */
async function enforce(method, pathname, headers = {}, config = {}) {
  // Concierge gets only the contact operations it needs, never an operator role.
  if ((method === "GET" && pathname === "/api/contacts") || (method === "PUT" && /^\/api\/contacts\/[^/]+$/.test(pathname))) {
    if (await require("../services/operator-auth").equalSecret(headers["x-internal-call-secret"], config.INTERNAL_CALL_SECRET)) {
      return { allowed:true, user:{id:"buddy-concierge",role:"service"} };
    }
  }
  const user = await resolveUser(headers, config);
  const permission = resolvePermission(method, pathname);

  // Health endpoint — always allowed
  if (permission === null) return { allowed: true, user };

  // Unknown route
  if (permission === undefined) {
    logger.warn("Permission check for unknown route", { method, pathname });
    return { allowed: false, user, error:"Unknown API permission" };
  }

  if (!hasPermission(user, permission)) {
    logger.warn("Permission denied", { userId: user.id, role: user.role, permission, method, pathname });
    return { allowed: false, user, error: `Forbidden: requires ${permission}` };
  }

  return { allowed: true, user };
}

module.exports = { enforce, hasPermission, resolveUser, resolvePermission, PERMISSION_MAP, ROUTE_PERMISSIONS };
