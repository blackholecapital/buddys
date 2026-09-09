# Buddy Call Center and operating guide

This pass adds Call Center beside Pipeline, Leads, Documents, and Deliveries at
`/buddy-dashboard`. It uses Buddy's existing customer records, Concierge voice
service, and call telemetry. The pipeline styling is retained.

## Included

- Searchable lead queue with premium customer cards and a selected-customer panel.
- Manual intake for incoming customer inquiries, without automatic messaging or
  dialing. Website intake retains its existing behavior. International phone
  validation and an existing-phone check help avoid accidental duplicate entries.
- Explicit outbound call confirmation; acceptance requires a provider call ID.
  Opted-out contacts are blocked, including when a stale live contact snapshot
  disagrees with the dashboard opt-out. Request IDs prevent repeated delivery of
  the same call request from dialing twice, including ambiguous failures.
- Persistent callback reminders, notes, rescheduling, cancellation, and handled
  status. One latest callback record per customer; optimistic versions reject
  stale edits. Times are stored in UTC and displayed in the operator's timezone.
- Captured calls, provider event status, transcripts, and a call history selector.
  This is a recent telemetry window, not a recording player or complete archive.
- Bottom-right 24-hour self-service operating guide: searchable articles, topic
  tabs, keyboard dismissal, and navigation shortcuts. Includes store/corporate
  workflows, access, integration boundaries, and troubleshooting. It does not
  claim live human staffing or submit tickets.
- Empty/unavailable data states replace the old synthetic fallback customer.
  Missing lead scores are shown as unknown instead of an invented default.

Callbacks are **operator reminders**, not an automatic dispatcher. A scheduled
reminder never places a call. Mark handled does not end a call or change the sales
stage. Existing website-triggered calls are unchanged apart from requiring
provider acceptance before reporting a successful request.

## API and storage

`GET /api/call-center` requires `contacts:read` and returns callbacks.
`POST /api/call-center` requires `contacts:write` and accepts:

- `action: intake`, `firstName`, `lastName`, `phone`, `email`, `interest`, `comments`.
- `action: callback`, `contactId`, ISO `dueAt`, `note`, `status` and the previously
  returned `version` when editing. Status is scheduled, completed, or cancelled.

`POST /api/calls` retains operator permissions and accepts `contactId` plus an
optional `requestId`. The new UI supplies and reuses a UUID until acceptance.
Ambiguous failures must be checked in the provider log before a new attempt.
Idempotency is per request ID; separate browser sessions/new request IDs are not
an automatic active-call lock. Operators must check current call activity.

The dashboard creates `buddy_callbacks` and `buddy_operator_calls` additively in
its existing `BUDDY_DB`. No credentials, new database bindings, shared runtime
changes, or cross-product configuration are required. Callback storage failures
fail closed. Existing dashboard contact persistence handles intake records.

## Release and acceptance

Ship the Buddy Concierge, dashboard Worker, and frontend using the existing
repository release procedure, preserving their configured bindings and secrets.
The new UI requires the new dashboard API. No production deployment or live
customer call was performed during this pass.

After release, use an authorized controlled test customer to verify one incoming
lead, one accepted call and its terminal event, callback persistence across two
operator sessions, a conflicting edit, and mobile support navigation. Confirm
viewer actions are denied and agent actions are permitted. If provider activity
is ambiguous, inspect it before retrying.

## Validation

- Frontend TypeScript and production build.
- `node scripts/test-buddy-call-center.cjs`: real SQLite callback SQL, conflicts,
  intake validation, role permissions, opt-outs, sales-stage preservation, and
  repeated/ambiguous call requests. Requires Node 22.13+ (built-in SQLite).
- `node scripts/test-buddy-call-center-browser.mjs`: actual built React UI in
  Chromium with API fixtures, covering call confirmation/double-click, intake,
  callback editing/handled, transcripts, opt-outs, guide search/keyboard/mobile,
  and empty/unavailable states. Uses the existing pinned browser dependencies.
- Existing dashboard tests, production security, video commerce/session fixture
  checks, bundle boundary, and sealed tenant-kit validation.

## Remaining stages

1. **Release acceptance:** deploy the Buddy-owned changes and verify the controlled
   customer workflow and operator access against live provider configuration.
2. **Existing-system integration:** agree the CRM source and fields, then add its
   authenticated ingestion/upsert adapter, external IDs, deduplication rules,
   and callback ownership. Manual intake and existing Buddy intake work now.
3. **Call operations expansion:** if requested, add assignments, structured
   dispositions, full callback audit history, provider reconciliation/active-call
   locks, retention rules, and any approved automatic dispatch policy.

The broader capacity/rate-limit and shared-server controls remain separate work
from this Buddy operator interface.
