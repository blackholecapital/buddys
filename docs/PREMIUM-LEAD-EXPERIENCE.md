# Buddy's premium lead experience

The customer demo at `/buddys/#contact-form` now combines the existing conversation,
lead form and catalog. BHC's premium presentation is the read-only design reference;
all APIs, assets and tenant bindings belong to Buddy's.

## Formats

- Page: seated Buddy above branded chat, compact intake in the center, product rail on the right.
- Widget: compact version of the same shopping experience.
- Pop-up: native modal dialog with Buddy/chat and intake; no product rail.
- Mobile: Buddy/chat followed by intake; no product rail. Real screens at 760px or below use this arrangement automatically.
- Tablet widths between 761 and 1100px retain the product rail below the two main columns.

One form and one session instance move between formats. Entered fields and conversation
history survive switches. Closing the pop-up ends media and returns the workspace to
its previous format. Video remains an explicit action; initial page render fetches only
the public catalog. Native field validation and optional SMS consent use the existing
lead contract. Submitting Message/Video links the guest conversation to the lead.

The displayed product ID/category accompany text and video-session requests. The server
resolves those hints against the committed catalog and supplies facts to Buddy; client
product descriptions are ignored. Product mentions follow the featured tile. Explicit
product browsing during a live session sends a product explanation through the existing
session channel. Assistant-driven tile updates do not trigger another explanation.
The existing signed agreement/delivery flow remains gated by explicit selection.

## Verification

Passed locally:

- Frontend TypeScript/Vite production build.
- Dashboard contract, async, integration and security suites.
- Commerce integration through Pages, dashboard and the sealed adapter, including forged
  catalog hints, guest linking, replay protection, document/delivery and video fallback.
- Existing media lifecycle test doubles, including allocation cancellation and denied mic.
- Chromium at 1440, 1024, 390 and 320px: every format, preserved drafts, submission from
  each format, SMS consent, guest-to-lead linking, product browsing/selection/following,
  text after video failure, bounded video elements, no horizontal overflow or page errors.
- Visual inspection of page, widget, pop-up and mobile screenshots.
- Tenant kit validation: all 12 sealed files match adapter 1.1.0.
- Diff limited to Buddy-owned UI/API/tests/docs; no shared configuration or bindings changed.

Browser and commerce tests use API/provider fixtures. Public page HEAD returned 200,
but live API probes from this environment returned 403. Live LLM, microphone, avatar
rendering and external message delivery have not been accepted from this environment.
No production deployment or workflow dispatch was performed.

## Release

Merge this change, then use the repository's existing customer release runbook/script
(`scripts/deploy-buddy-customer.sh`). Both Pages and Buddy's dashboard must be released
because the catalog grounding is server-side. Do not modify the sealed runtime kit or
any shared runtime. After release, check a real guest text conversation, product follow,
video connect/end, each lead format and the received lead in the operator dashboard.
Confirm live delivery separately with an authorized test recipient.
