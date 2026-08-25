# Release Checklist (Stage 6 Hardening)

## 1) Environment and config validation
- Verify `NODE_ENV`, provider credentials, and rate-limit settings via `/api/health?ready=1&metrics=1&dlq=1`.
- Confirm no secret values are exposed in logs (only `env.safeConfig()` output is allowed).

## 2) Regression matrix
- Run `npm test` (contracts + async workflows + integration).
- Run `npm run test:acceptance` for operator flow:
  - contact → template → campaign → send → reply → follow-up → opt-out → reconciliation.

## 3) Data and idempotency checks
- Re-run campaign send and follow-up jobs; confirm no duplicate outbound messages.
- Confirm opted-out contacts cannot be messaged from API endpoints.
- Check `/api/reconciliation` for zero unexpected conflicts/orphans before release.

## 4) Deployment and rollback
- Deploy backend and worker together (API + jobs are coupled by state transitions).
- Keep prior artifact ready for immediate rollback.
- Smoke-test endpoints after deploy:
  - `/api/health?ready=1`
  - `/api/dashboard`
  - `/api/campaigns/run`
  - `/api/automation/run-followups`

## 5) Known risks to monitor
- File-backed persistence is single-process oriented; multi-instance deployments require durable shared storage.
- In-memory idempotency cache resets on process restart; rely on campaign state locks + persistence for safety.

## 6) Residual risk note (Stage 6B)
- Fully covered in code/tests: role-gated API authorization checks, malformed JSON handling, input sanitization guardrails, stale lock recovery paths, and lock diagnostics in health output.
- Partially mitigated: lock safety across true distributed workers (requires durable shared DB semantics and coordinated clock discipline).
- Infra-stage required: real session expiry/logout, token invalidation, centralized auth provider integration, and production alerting/dashboards.
