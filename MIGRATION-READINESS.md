# Buddy's shared-plane migration readiness

> Preparation record only. The authoritative executable procedure is
> [`blackholecapital/AI-Agent-Command-Center/MIGRATION.md`](https://github.com/blackholecapital/AI-Agent-Command-Center/blob/main/MIGRATION.md).
> Do not deploy or switch Buddy's production UI from this document.

## Scope

Migrate only Buddy's talking-head path to the sealed `blackhole-tenant-v1`
adapter. Keep the existing Buddy application, dashboard, concierge, phone,
SMS, email, DocuSign, calendar, data resources, and Pages deployment intact.
No shared-plane component or other tenant may be changed or restarted.

## Recorded rollback boundary

| Item | Recorded value |
|---|---|
| Tenant | `buddys` |
| Repository | `blackholecapital/buddys` |
| Production rollback commit | `b91013f10d09b5193fd248c38a2edec391596619` |
| Product origin | `https://buddys.pages.dev` |
| Existing product route | `https://buddys.pages.dev/buddys/` |
| Existing concierge health | `https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev/api/health` |
| Existing dashboard health | `https://buddys-dashboard-worker.cryptocapitalgroupfl.workers.dev/api/health` |
| Existing video health | `https://buddys-video-worker.cryptocapitalgroupfl.workers.dev/health` |
| Legacy deployment record | [`PASS2-DEPLOYMENT.md`](./PASS2-DEPLOYMENT.md) |

`PASS2-DEPLOYMENT.md`, `apps/video-worker`, `apps/livekit-avatar-agent`, and the
Buddy runtime installation/tuning scripts are legacy rollback assets during
the migration. Do not install, restart, redeploy, or modify them to make the
shadow adapter work.

## Intended shadow identity

These names follow the Command Center generator defaults. The adapter hostname
must be confirmed available before the canonical migration command is run.

| Resource | Intended value |
|---|---|
| Adapter hostname | `buddys-assistant.xyz-labs.xyz` |
| Worker | `buddys-assistant-adapter` |
| R2 bucket | `buddys-assistant-assets` |
| Assistant | `buddy` |
| Namespaced voice | `buddys-buddy` |
| Shared runtime | `https://blackhole-runtime.xyz-labs.xyz` |
| Shared LiveKit agent | `blackhole-avatar` |

## Hard gates before a migration PR

- [ ] Run unscoped `npm run readiness` from a clean Command Center `main`
      checkout; both gates must print `READY`.
- [ ] Confirm one successful text response on the current Buddy route.
- [ ] Confirm one current LiveKit session publishes remote audio and video.
- [ ] Confirm `buddys-assistant.xyz-labs.xyz` is available in the active zone.
- [ ] Create the operator-only Cloudflare Access application for
      `https://buddys-assistant.xyz-labs.xyz/settings*`.
- [ ] Record the exact Access team domain and the new application's real AUD;
      never guess or commit a placeholder.

If the shared plane or more than one tenant is red, stop and recover from the
Command Center owner repository. Do not patch Buddy's around the outage.

## Latest readiness result

The unscoped Command Center gate was run from current `main` on 2026-09-03 UTC:

| Gate | Result |
|---|---|
| New tenant onboarding | `READY` |
| Legacy tenant migration | `BLOCKED` |
| Shared runtime | Healthy |
| AI Fans | Unhealthy: live health response is missing `healthContract`, `tenantId`, and `planeId` |
| EILA Overwatch | Unhealthy: live readiness response is missing `healthContract`, `tenantId`, and `planeId` |

AI Fans `main` already emits the required `blackhole-tenant-v1` identity, so
its blocker is a stale tenant Worker deployment. EILA Overwatch `main` does not
yet emit the required top-level readiness identity and needs a tenant-local PR.
Neither prerequisite authorizes a Buddy task to change or deploy those tenants.
The Buddy migration remains stopped at the readiness gate.

## No-downtime PR sequence

1. In the Command Center, run the canonical `tenant:migrate` command for
   `buddys`, validate, generate the sealed tenant kit, and merge the preparation
   PR after review.
2. Copy the complete generated kit into this repository as
   `blackhole-runtime/`, add the mandatory root `AGENTS.md` pointer, verify the
   seal from the Command Center, and merge a Buddy tenant-kit PR. Do not switch
   the production UI yet.
3. Deploy only `blackhole-runtime/deploy.sh`, upload Buddy's avatar and 10–60
   second WAV through the protected settings page, and run `tenant:verify`.
4. In a separate Buddy PR, switch only Buddy's browser talking-head client to
   the shadow adapter. Deploy only Buddy's named application target and smoke
   text, remote audio, and remote video.
5. Confirm another green tenant remains green. Then run `tenant:cutover` in the
   Command Center and merge the small registry cutover PR.

Keep the rollback commit and legacy deployment available through the
observation window. Removing legacy code is a later cleanup, not part of the
cutover.

## Baseline validation at the rollback commit

Recorded on 2026-09-03 UTC:

- Buddy video configuration contract: pass.
- Dashboard contract, async, integration, and security tests: 127 passed.
- Video Worker tests: 4 passed after `npm ci`.
- Frontend TypeScript/Vite production build: pass.
