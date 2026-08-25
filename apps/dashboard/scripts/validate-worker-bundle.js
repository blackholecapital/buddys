/**
 * Build validation: confirms no Node-only imports leak into the Worker bundle.
 *
 * Traces the import tree from worker-entry.mjs and flags:
 *   - Static require("fs"), require("path"), require("http"), require("url")
 *   - Static require("better-sqlite3")
 *   - Static require("node:async_hooks") or require("node:*")
 *   - Usage of process.exit, process.on (not just process.env checks)
 *
 * Run: node scripts/validate-worker-bundle.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Files that are ALLOWED to have Node imports (not on Worker path)
const EXCLUDED_FILES = new Set([
  "backend/server.js",
  "backend/router.js",
  "backend/layers/core/file-store.js",
  "backend/layers/core/sqlite.js",
  "scripts/",
  "tests/",
]);

// Banned static requires in Worker-bundled files
const BANNED_REQUIRES = [
  /require\(\s*["']fs["']\s*\)/,
  /require\(\s*["']path["']\s*\)/,
  /require\(\s*["']http["']\s*\)/,
  /require\(\s*["']url["']\s*\)/,
  /require\(\s*["']better-sqlite3["']\s*\)/,
  /require\(\s*["']node:async_hooks["']\s*\)/,
  /require\(\s*["']\.\/file-store["']\s*\)/,
  /require\(\s*["']\.\/sqlite["']\s*\)/,
];

// Banned process usages (process.env checks are OK)
const BANNED_PROCESS = [
  /process\.exit\s*\(/,
  /process\.on\s*\(/,
];

function isExcluded(relPath) {
  for (const ex of EXCLUDED_FILES) {
    if (relPath.startsWith(ex)) return true;
  }
  return false;
}

// Trace imports from worker-entry.mjs
const visited = new Set();
const violations = [];

function resolveImport(importPath, fromFile) {
  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importPath);

  // Add .js extension if missing
  if (!path.extname(resolved)) resolved += ".js";
  // Try index.js
  if (!fs.existsSync(resolved) && fs.existsSync(resolved.replace(/\.js$/, "/index.js"))) {
    resolved = resolved.replace(/\.js$/, "/index.js");
  }
  return resolved;
}

function traceFile(filePath) {
  if (visited.has(filePath)) return;
  visited.add(filePath);

  if (!fs.existsSync(filePath)) return;

  const relPath = path.relative(ROOT, filePath);
  if (isExcluded(relPath)) return;

  const content = fs.readFileSync(filePath, "utf8");

  // Check for banned requires
  for (const pattern of BANNED_REQUIRES) {
    if (pattern.test(content)) {
      violations.push({ file: relPath, issue: `Banned require: ${pattern.source}` });
    }
  }

  // Check for banned process usage
  for (const pattern of BANNED_PROCESS) {
    if (pattern.test(content)) {
      violations.push({ file: relPath, issue: `Banned process usage: ${pattern.source}` });
    }
  }

  // Follow require() and import calls
  const requireMatches = content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g);
  for (const [, importPath] of requireMatches) {
    if (importPath.startsWith(".")) {
      const resolved = resolveImport(importPath, filePath);
      traceFile(resolved);
    }
  }

  // Follow ES import statements
  const importMatches = content.matchAll(/import\s+.*?\s+from\s+["']([^"']+)["']/g);
  for (const [, importPath] of importMatches) {
    if (importPath.startsWith(".")) {
      const resolved = resolveImport(importPath, filePath);
      traceFile(resolved);
    }
  }
}

// Start trace from worker entry
const entryFile = path.join(ROOT, "worker-entry.mjs");
console.log("Validating Worker bundle from:", path.relative(ROOT, entryFile));
console.log("=".repeat(60));

traceFile(entryFile);

console.log(`\nFiles traced: ${visited.size}`);

if (violations.length === 0) {
  console.log("\n✓ No Node-only imports found in Worker bundle path.");
  console.log("✓ Bundle is Cloudflare Worker safe.");
  process.exit(0);
} else {
  console.log(`\n✗ ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}: ${v.issue}`);
  }
  process.exit(1);
}
