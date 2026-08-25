# Dev Notes

## Pass 6 status — Resolve Cloudflare Edge Runtime Failures
Fixed all Cloudflare Worker runtime failures: true ES module entrypoint, no static Node-only imports in bundle, modern compat flags, and build validation.

### What was implemented in Pass 6

#### ES Module Worker Entrypoint (`worker-entry.mjs`)
- **`export default { fetch(), queue() }`** — true Cloudflare Module Worker format
- Replaces `module.exports` (Service Worker / CommonJS style) that fails on `wrangler deploy`
- ES `import` statements for all dependencies — clean static analysis for bundler
- Old `worker-entry.js` (CommonJS) preserved for reference but no longer used

#### Node-Only Import Elimination
- **`backend/layers/core/db.js`** — removed ALL static requires to `file-store`, `memory-store`, `sqlite`. Backend is now injected via `setBackend()` — no auto-detection, no conditional requires. This is the single most important change: it prevents wrangler's esbuild from pulling `fs`, `path`, `better-sqlite3` into the Worker bundle.
- **`backend/layers/core/persistence.js`** — dynamic `require()` for `file-store` and `sqlite` using string concatenation (`"./file" + "-store"`). The bundler cannot statically resolve these, so they're excluded from the Worker output. They still work correctly at runtime on Node.
- **`shared/logger/index.js`** — dynamic `require()` for `node:async_hooks` using string concatenation (`"node:" + "async_hooks"`). The bundler skips it; Node resolves it at runtime.

#### Wrangler Configuration (`wrangler.toml`)
- **`main = "worker-entry.mjs"`** — points to ES module entry
- **`compatibility_flags = ["nodejs_compat"]`** — modern flag replacing deprecated `node_compat = true`
- **`compatibility_date = "2024-09-23"`** — updated to modern baseline
- D1, Queue, and dev environment bindings unchanged from Pass 5

#### Build Validation Script (`scripts/validate-worker-bundle.js`)
- Traces the full import tree from `worker-entry.mjs` (57 files)
- Flags any static `require("fs")`, `require("path")`, `require("http")`, `require("better-sqlite3")`, `require("node:async_hooks")`, `require("./file-store")`, `require("./sqlite")` in bundled code
- Flags `process.exit()` and `process.on()` in bundled code
- Excludes known Node-only files: `backend/server.js`, `file-store.js`, `sqlite.js`, `scripts/`, `tests/`
- Run: `npm run validate:bundle`

#### Test Infrastructure Update
- `tests/async-workflows.test.js` — explicitly initializes `db.setBackend(fileStore)` before importing domain modules, since db.js no longer auto-detects

### Exact files changed in Pass 6

| File | Change |
|------|--------|
| `worker-entry.mjs` | **NEW** — ES module Worker entrypoint with `export default` |
| `backend/layers/core/db.js` | Removed all static requires; backend must be injected via `setBackend()` |
| `backend/layers/core/persistence.js` | Dynamic requires for file-store and sqlite (bundler-safe) |
| `shared/logger/index.js` | Dynamic require for node:async_hooks (bundler-safe) |
| `shared/env/index.js` | Version bump |
| `wrangler.toml` | `main = "worker-entry.mjs"`, `compatibility_flags = ["nodejs_compat"]` |
| `package.json` | v0.6.0, added `validate:bundle` script |
| `scripts/validate-worker-bundle.js` | **NEW** — import tree validator |
| `tests/async-workflows.test.js` | Explicit backend init |

### Non-edge fallbacks still retained

These files contain Node-only code and are intentionally excluded from the Worker bundle:

| File | Node APIs | Purpose |
|------|-----------|---------|
| `backend/server.js` | `http`, `fs`, `path`, `url`, `process` | Node HTTP server |
| `backend/router.js` | `url` (Node) | Node req → edge-router wrapper |
| `backend/layers/core/file-store.js` | `fs`, `path` | File-backed JSON persistence |
| `backend/layers/core/sqlite.js` | `fs`, `path`, `better-sqlite3` | SQLite persistence |
| `scripts/dev/run-local.js` | `process` | Dev server launcher |
| `tests/*.test.js` | `http`, `fs`, `path` | Test infrastructure |

### Cloudflare runtime assumptions

1. **Module format**: ES modules (`export default`). CommonJS files are bundled by wrangler's esbuild — `require()` works inside them but `module.exports` in the entrypoint does not.
2. **Node compat**: `compatibility_flags = ["nodejs_compat"]` enables `Buffer`, `crypto.subtle`, `TextEncoder/Decoder`, `URL`, and other Web + Node polyfills. The old `node_compat = true` is deprecated.
3. **No filesystem**: Workers have no `fs` access. All persistence goes through D1 or in-memory store.
4. **No process**: `process` is undefined in Workers. All code checks `typeof process !== "undefined"` before access.
5. **No AsyncLocalStorage**: Workers don't support `node:async_hooks`. Logger uses simple variable-based context (safe because Workers are single-request-per-isolate).
6. **D1 is async**: Domain code is sync (`readDb()`/`mutate()`). The `d1-cached-store` bridges this: `load()` at request start → sync cache operations → `flush()` at request end via `ctx.waitUntil()`.
7. **Queues**: Jobs dispatched via `env.FOLLOWUP_QUEUE.send()`. Consumer receives batches via `queue(batch, env, ctx)` handler. Messages are acked/retried per item. DLQ configured in wrangler.toml.
8. **Static analysis**: wrangler uses esbuild to bundle. Any `require("moduleName")` with a string literal gets resolved at build time, even inside `if (false) {}` blocks. Use string concatenation for Node-only dynamic requires.

### Run locally (Node)
```bash
npm start               # File backend, port 3000
npm run dev             # Development mode
npm test                # All 70 tests
npm run validate:bundle # Verify Worker bundle safety
```

### Run locally (Edge / Wrangler)
```bash
npx wrangler dev                # Boots with local D1 + memory queue
npx wrangler dev --env dev      # Dev environment overrides
npx wrangler deploy             # Deploy to Cloudflare
```

### Remaining production blockers for Pass 7+
1. Add KV namespace for persistent idempotency keys on edge
2. Add real auth (JWT/session) replacing stub user resolution
3. Add D1 migration tooling for schema evolution
4. Cloudflare Pages integration for frontend
5. Pipe metrics to Workers Analytics Engine
6. Upgrade frontend to target app framework
7. AI/CRM/calendar integration features
8. Multi-tenant support
9. Load testing D1 cached store under concurrent requests
