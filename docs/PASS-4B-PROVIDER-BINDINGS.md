# Provider bindings follow-up

Status: implemented and locally tested; not deployed by this session.

The September 6 operator inventory confirmed the Concierge RSA and Connect HMAC
secrets are installed. It also confirmed active central provider secrets, missing
provider bindings, the dashboard's existing D1 IDs, and its missing `ASSISTANT`
service binding. No secret values from that inventory are included in this change.

## Changes

- Concierge binds the existing DocuSign account/user/integration IDs and Google
  client ID/client secret/refresh token from store `00b34d29f2c94685b0f250dc5b1ee875`.
- SMS and voice bind the existing Twilio SID/auth token. Voice additionally binds
  Deepgram. Email binds Resend. Names use the confirmed `XYZ_DEMO_` bundle.
- All four provider Workers resolve the declared secret bindings with async
  `.get()` before provider logic runs. Ordinary Worker secrets still work. Values
  are request-scoped, not written back to the shared environment. Resolution errors
  return a generic 503 without the provider exception/value or a provider send.
- Dashboard database placeholders are replaced with the exact existing Buddy IDs:
  dashboard `14229cf4-17bf-436f-a69f-00d133c12b5f`, message tracking
  `34ef42d7-ccef-4ba4-b57c-ecabc5ad8f81`. Its committed `ASSISTANT` binding targets
  `buddys-assistant-adapter`.
- No shared runtime, sealed adapter files, central secret values, internal tokens,
  or other tenant resources are modified.

The DocuSign client secret is not used by this JWT authentication flow. The RSA
private key stays an ordinary Worker secret. Central secrets must be scoped to
Workers. See [Cloudflare's binding contract](https://developers.cloudflare.com/secrets-store/integrations/workers/).

## Deploy this bounded pass

After merging, on the authenticated blackhole server (Python 3.11+, Node 22+):

```bash
cd "$HOME/repos/buddys" && git pull --ff-only && python3 scripts/deploy-buddy-bindings.py --apply
```

The helper uses `CLOUDFLARE_API_TOKEN` or one hidden token prompt. It checks all
selected Workers before deploying, verifies central secret metadata and live D1
ownership, refuses conflicting credential bindings, validates the sealed kit,
and bundles every selected target before the first deploy. Account and targets
are explicitly fixed to this repository's Buddy resources. It uses Wrangler
4.126.0 and `--keep-vars` to preserve dashboard-configured variables. Ordinary
encrypted Worker secrets are preserved by Wrangler; the helper never retrieves,
generates, or rotates secret values.

**Default targets, in order:** `buddys-concierge-worker`, then
`buddys-dashboard-worker`. This activates the core provider bindings and the
dashboard-to-assistant service declaration. It does not deploy Pages or the sealed
adapter. It does not promise a complete live sale while channel prerequisites
remain missing.

Run without `--apply` for preflight/bundling only. Once channel setup is complete,
use `--all --apply` to deploy SMS, email, voice, Concierge, then dashboard. Missing
prerequisites stop the whole selected batch before any deploy. Cloudflare deploys
are not atomic across Workers: a failure during application stops the remaining
targets; successful earlier deploys remain applied. Record Wrangler's version IDs.
Correct the reported failure and rerun the same command. For rollback, use the
recorded previous version of the affected Buddy Worker; no shared target belongs
in a rollback command.

## Remaining live setup and acceptance

- **Internal authentication:** metadata shows secrets on dashboard, Concierge,
  and voice; it cannot prove their values match. SMS/email lacked one. Align Buddy
  internal authentication deliberately during release setup; don't infer equality
  from names or rotate the existing three during this binding pass.
- **SMS/voice:** an actual Twilio sending number is still needed. Voice's
  `BUDDY_RUNTIME_TOKEN` mapping needs verification against its runtime target;
  neither of the central runtime token names establishes the correct value.
- **Email:** `FROM_EMAIL` must identify an approved Resend sender. The preflight
  requires this binding in addition to the key and internal secret.
- **Operator access:** missing `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and
  `OPERATOR_ROLES_JSON` keep production operator routes denied. The helper reports
  their absence; it does not weaken Access to get the deployment through.
- **Sealed adapter:** runtime and capability both point at the same EILA-named
  token in the inventory. Do not switch either based on its name alone. Verify
  Buddy session creation against the existing broker contract during acceptance.
- Verify `/api/health` reports DocuSign/Calendar configured after core deployment.
  This reports configuration presence, not provider health. Then test consent/JWT
  exchange, an actual agreement, signed Connect callback, delivery scheduling,
  and SMS/email receipts using a controlled test contact after channel setup.

## Verification

- `node scripts/test-worker-secrets.mjs`: request isolation, ordinary secrets,
  async binding values, missing/invalid lookup responses, redacted failures,
  actual SMS/email Worker provider headers and voice auth.
- `node --experimental-strip-types scripts/test-video-commerce.mjs --secrets-store`:
  full sales contract with async DocuSign credentials, real JWT signing and Google
  refresh-token request construction; only external provider/media edges stubbed.
- Existing plain-secret commerce, 48 production security checks, 127 dashboard
  assertions, bundle isolation, sealed kit validation and frontend build.
- Wrangler dry-runs for all five changed Worker configurations.
- `python3 scripts/test-buddy-binding-deploy.py`: prerequisites, central metadata,
  collisions, reruns, and database ownership gates. No live credentials used.

CI runs the new secret and deployment-gate checks as part of the Buddy contract job.
