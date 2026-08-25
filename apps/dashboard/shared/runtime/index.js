/**
 * Runtime detection.
 *
 * Detects whether we're running in Cloudflare Workers, Node.js,
 * or a test environment. All runtime-conditional code checks this
 * instead of doing its own feature detection.
 */

const RUNTIME = {
  EDGE: "edge",
  NODE: "node",
  TEST: "test",
};

function detect() {
  // Cloudflare Workers have no process.versions.node but have caches global
  if (typeof process === "undefined" || (!process.versions?.node && typeof caches !== "undefined")) {
    return RUNTIME.EDGE;
  }
  if (process.env?.NODE_ENV === "test") {
    return RUNTIME.TEST;
  }
  return RUNTIME.NODE;
}

let cached = null;

function current() {
  if (!cached) cached = detect();
  return cached;
}

function isEdge() { return current() === RUNTIME.EDGE; }
function isNode() { return current() === RUNTIME.NODE || current() === RUNTIME.TEST; }

// Allow override for testing
function override(runtime) { cached = runtime; }
function reset() { cached = null; }

module.exports = { RUNTIME, detect, current, isEdge, isNode, override, reset };
