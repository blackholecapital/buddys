# Buddy finalization stages

## Pass 1 — Video commerce contract (implemented, pending deployment)

The September 4 Pages cutover went directly to the sealed media adapter and omitted the business session contract. Pages now routes through the dashboard. The dashboard retrieves current commerce state from authenticated Concierge `/internal/video/context`, then creates media using its `ASSISTANT` service binding to `buddys-assistant-adapter`.

The response includes media credentials, canonical contact/session identity, HMAC workflow token, transcript history, two product options, document/delivery phase, and a contextual resume prompt. The browser sends the prompt through its existing workflow channel. The sealed tenant kit remains unchanged. Guest sessions remain media-only: completing commerce requires a linked lead.

Transcript writes now require the same contact/session signature as workflow actions. Starting or ending video preserves the customer's sales stage. Missing business/media configuration and incomplete media responses fail instead of presenting a usable commerce session.

### Verification

- `node --experimental-strip-types scripts/test-video-commerce.mjs` (Node 22.18+): real Pages, dashboard handlers, Concierge and sealed adapter; in-memory SQLite with a D1 interface; stubbed media, SMS/email, DocuSign and Calendar edges. Covers lead submission, two products, selection, agreement sending, duplicate selection, simulated signed callback, three delivery choices, scheduling, CRM update, transcript authentication/deduplication/history, resume phases, missing lead/secret, malformed media, and broker failure. Unrecognized outbound requests fail the test.
- `npm test --prefix apps/dashboard`: 127 assertions pass across contracts, async workflows, integration and role matrix. These legacy role tests do not establish production identity security.
- `npm run validate:bundle --prefix apps/dashboard`: Worker import boundary passes.
- `npm run build --prefix apps/frontend`: TypeScript and Vite pass.
- `npm run validate --prefix blackhole-runtime`: all 12 sealed files match version 1.1.0.
- `node scripts/test-video-config.mjs`: existing adapter/rollback checks pass.
- CI now watches Pages/frontend, dashboard and sealed tenant files and runs commerce regression, existing suites, bundle validation, kit validation and frontend build.

This is handler integration coverage, not a browser DOM/media end-to-end test. It does not prove real provider delivery, avatar participation, current Cloudflare bindings or remote D1 state. No production deployment was performed.

### Deployment order and acceptance gate

1. Deploy the Buddy Concierge Worker from this repository with `/internal/video/context`; keep its existing internal secret and data bindings.
2. Deploy `buddys-dashboard-worker` with the new `ASSISTANT = buddys-assistant-adapter` service binding and existing `CONCIERGE`, `INTERNAL_CALL_SECRET`, dashboard D1 and Buddy D1 bindings. Resolve committed D1 placeholders to the existing Buddy resources through the deployment runbook; do not create replacements by guesswork.
3. Deploy Buddy Pages with the dashboard binding. Deploy backend dependencies before Pages so the public route does not get ahead of its contract.
4. Run a controlled test lead: verify contact/session/workflow fields, two products, actual Buddy avatar participation, document sending/signing, three delivery choices, scheduled CRM state and persisted transcript after closing/reopening.
5. Confirm every resource remains Buddy-owned and the media tenant is `buddys`. No shared runtime changes or deployments are required. The sealed adapter does not need redeployment for this pass.

## Pass 2 — Security and honest provider failures

Before external testing:

- Replace caller-selected `x-user-role` with validated Access/session identity and real role mappings; restrict dashboard CORS.
- Protect tenant settings, currently configured public, using the supported Access configuration.
- Authorize public lead/session access: a known contact ID alone must not grant someone another customer's history or a fresh workflow token. Add token expiry/revocation and replay policy.
- Validate DocuSign Connect callbacks and envelope/contact association. Current `/docusign/connect` accepts a completed payload without signature validation; the Pass 1 test simulates that callback but does not certify it safe. Protect signed-document downloads too.
- Production providers must fail closed; surface partial sending failures, retries and idempotency without claiming delivery succeeded.
- Verify internal service identity remains compatible when locking down dashboard contact reads/writes used by Concierge.

Exit: unauthorized role/settings/contact/transcript/callback/document access rejected; provider failure visible; authorized sales path passes.

## Pass 3 — Independent messaging and video handoff

- Expose lightweight chat through the sealed adapter `/api/chat`; Message Buddy must not start LiveKit or allocate avatar resources.
- Persist text conversation identity/history and share the same commerce actions.
- Upgrade to video with the same lead, product, document and delivery state; text remains usable when media is unavailable.

Exit: text-only selling works without GPU/video; upgrade and reconnect retain state.

## Pass 4 — Showroom V1

- Structure the existing two choices with approved images, descriptions, specs, product links and optional confirmed pricing labels.
- Build two product cards with expanded product view, showroom background and small Buddy video panel.
- Emit product shown/opened/selected events and connect selections to the existing agreement/delivery actions.

Exit: category browsing and selection work on desktop/mobile using approved product facts/assets.

## Pass 5 — Rate Limits & Capacity

- Expand the existing Rate Limits page into the scaling panel.
- Replace the shared timestamp bucket with atomic per-channel limits and concurrency authority.
- Add Buddy video allocation, active/waiting sessions, warm-capacity requests, backpressure, retry/fallback rules, kill switches and usage/cost guards.
- Show only capacities measured or enforced by an existing runtime contract. Shared-runtime scaling work belongs to its owner; Buddy controls may consume supported contracts but must not reconfigure the shared host.

Exit: concurrent requests obey enforced quotas; overload/fallback behavior is visible and tested.

## Pass 6 — Operator telemetry and system health

- First-class TEXT/VIDEO/VOICE session status, product funnel, document and delivery progress.
- Provider throughput/errors, latency, queue pressure and last successful transaction.
- Health for adapter, shared dependencies, LiveKit, messaging, DocuSign, Calendar and storage; distinguish configured from verified healthy.

Exit: operators can identify a stuck sale and the failing dependency without reading raw logs.

## Pass 7 — Release verification and cleanup

- Reconcile Pages origin, Buddy D1 placeholders and canonical deployment substitution; mark old video path rollback-only and retire it after stabilization.
- Run browser end-to-end tests and controlled live-provider acceptance tests; verify remote migrations/bindings, retries, duplicates and delivery conflicts.
- Verify authenticated transcripts in Concierge and review startup/reconnect/fallback behavior across devices.
- Record exact deployed commits, smoke results and rollback steps.

Exit: an evidenced, repeatable test deployment and customer handoff.

## Pass 8 — Unreal renderer (after the stable V1)

- Render the same structured catalog and workflow events in Unreal.
- Add avatar movement and product presentation through the existing tenant boundary.
- Keep commerce, document and delivery logic independent of the renderer.

Exit: richer presentation with the same verified sales contract.
