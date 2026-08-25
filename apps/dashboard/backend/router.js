/**
 * Node-compatible router.
 *
 * Thin wrapper around edge-router that accepts Node's req object.
 * Parses URL using Node's url module and delegates to routeRequest.
 */

const url = require("url");
const { routeRequest } = require("./edge-router");

function route(req) {
  const parsed = url.parse(req.url, true);
  const headers = req.headers || {};
  return routeRequest(parsed.pathname, req.method, parsed.query || {}, headers);
}

module.exports = { route };
