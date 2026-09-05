# Pass 2 — Security implementation and deployment gates

Status: implemented and locally verified; not deployed. Pass 1 is merged in main.

## Implemented

- Production dashboard identity verifies Access RS256 signatures using the configured team's certificate endpoint, issuer, audience, expiry, not-before and an explicit email-to-role map. Caller-supplied role/email headers have no production authority. Development/test role fixtures remain local-only.
- Known routes require their mapped permission; unknown/dynamic route variations cannot fall through to a privileged handler. Cross-origin requests are rejected unless the exact origin is configured; wildcard CORS is removed.
- Concierge's internal secret authorizes only dashboard contact listing and individual contact updates. It does not grant settings or other operator permissions. Its service calls no longer recursively enter the dashboard persistence lock: trusted contact context goes to Concierge, and contact patches return in its response.
- Lead submission issues a customer capability valid for 24 hours. Video creation requires that capability for a linked lead. Workflow capabilities last two hours and bind purpose, contact, session and contact revocation version. A `publicSessionVersion` update on the dashboard contact revokes the existing capabilities; no secret rotation is necessary. Existing pre-pass tokens are deliberately rejected.
- Email call links are purpose-bound, expire after two hours and are consumed on first use. An ambiguous provider failure requires operator recovery instead of repeatedly placing calls from a replayed link.
- DocuSign Connect verifies HMAC-SHA256 over the original bytes before JSON parsing and matches the envelope to the stored contact. Envelope creation requests HMAC notifications and refuses to proceed without a verification secret. A D1 receipt with a one-minute processing lease suppresses concurrent/replayed completed callbacks; failed processing releases the lease for retry. Per-channel acknowledgement progress is recorded. Late callbacks preserve the sales stage.
- Signed-document downloads require verified mapped Access identity or the internal service secret; a contact ID alone is insufficient.
- Production dashboard SMS/email selection refuses mock or unknown providers and propagates load/configuration errors. Buddy SMS/email Workers require the internal service secret before sending. Concierge forwards that secret and rejects unsuccessful or malformed provider responses.
- Agreement retry reuses the persisted envelope/link and retries only messages not already accepted. Failed notification delivery does not masquerade as success. The browser describes the signing link and confirmed booking without inventing SMS/email delivery success.
- Settings protection uses `blackhole-runtime/deploy-access.sh`. It validates the sealed kit, creates a temporary config differing only in `SETTINGS_AUTH_MODE=access`, and deploys the existing Buddy adapter. All 12 sealed files remain byte-identical.

## Required configuration before deploying

| Target | Required configuration |
| --- | --- |
| Dashboard Worker | `NODE_ENV=production`; `CF_ACCESS_TEAM_DOMAIN` as the HTTPS team domain; the dashboard application's `CF_ACCESS_AUD`; `OPERATOR_ROLES_JSON`, a JSON object mapping actual operator emails to `admin`, `agent` or `viewer`; verify `ALLOWED_ORIGINS` against the deployed Buddy frontend. Unmapped users are denied. |
| Concierge Worker | Existing `INTERNAL_CALL_SECRET`, existing Buddy D1, and `DOCUSIGN_CONNECT_HMAC_SECRET` matching the key configured in DocuSign Connect. Configure Access team/audience/role map here as well if operators will open signed PDFs directly. |
| SMS and email Workers | Bind the existing `INTERNAL_CALL_SECRET` consistently with Concierge, alongside their existing provider credentials. Do not rotate shared secrets or copy another tenant's bindings. |
| Sealed Buddy adapter | Use `bash blackhole-runtime/deploy-access.sh`; verify its existing Access application policy admits only intended settings administrators. The sealed legacy `deploy.sh` retains its original public-settings config and is not the secure deployment entrypoint. |
| Access application | Protect the operator UI/API entrypoint so login supplies the assertion to Pages/Worker. Exclude only the intended public lead and signed customer routes. Application audience and actual operator membership must be verified in the account, not guessed. |
| DocuSign account | Enable Connect HMAC, bind its matching key to Concierge and verify the completed JSON event format. Do not send a real agreement before a signed callback has passed staging acceptance. |

No credentials were read, generated, rotated or deployed in this pass. The Access role map is intentionally not populated with guessed identities.

## Deployment order

1. Bind the existing internal secret to `buddys-sms-worker` and `buddys-email-worker` and configure Access/Connect prerequisites above.
2. Deploy `buddys-concierge-worker` with authenticated sending, signed Connect and dashboard-managed context support.
3. Deploy `buddys-sms-worker` and `buddys-email-worker` with the new send authorization. Concierge must forward the secret before their gates activate.
4. Deploy `buddys-dashboard-worker` with Access identity, capability tokens and the Pass 1 ASSISTANT binding; deploy Buddy Pages immediately after it so the lead form forwards the new customer token. Active pre-pass sessions must reopen from a new lead submission.
5. Deploy the existing adapter through `bash blackhole-runtime/deploy-access.sh`. Verify anonymous settings POSTs fail and intended admins succeed.
6. Run controlled acceptance: login/roles, lead→video→agreement→signed callback→delivery→transcript, rejected unsigned callback, expired/customer-mismatched session, failed provider/retry, and operator PDF access.

All deployments are limited to existing Buddy-owned targets. No shared runtime changes are required.

## Verification and practical limits

- 127 existing dashboard assertions pass.
- 40 production security checks run through the real Worker entrypoint and cryptographic fixtures: valid/invalid Access signatures and claims, role spoofing, dynamic paths, internal-service scope, CORS, token expiry/revocation/purpose, denied settings/document/send access and mock-provider rejection.
- Commerce regression uses real Pages/dashboard/Concierge/sealed-adapter handlers with in-memory SQLite and provider/media stubs. It covers rejected callbacks, signed completion, replay suppression, partial agreement sending and retry without a duplicate envelope or repeated accepted SMS, transcript authentication and resume. It asserts dashboard-originated operations do not recursively call the dashboard.
- Frontend build, Worker import boundary, dashboard and Concierge Wrangler dry-run bundles, existing video contract, and all 12 tenant-kit integrity checks pass.

These are integration/cryptographic tests, not proof of deployed Access policy, real provider delivery, live browser media, or remote D1 state. Provider acceptance and local persistence are not one atomic transaction: a process failure between a provider accepting a request and recording its ID can still require operator reconciliation. Exactly-once external effects are not claimed. The existing global rate/concurrency governor remains Stage 5 work; external test deployment still requires the controlled acceptance gate.

References: [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [DocuSign Connect HMAC validation](https://developers.docusign.com/platform/webhooks/connect/validate/).
