# Pass 3 — Independent messaging and video handoff

Message Buddy previously created a LiveKit room and waited for an avatar, even for a text conversation. It now opens a private text session and sends messages through the sealed tenant adapter's existing `/api/chat` contract. LiveKit loads only when the customer requests video. No shared runtime or sealed kit file changes are needed.

## Behavior

- The preferences form offers “Message Buddy here” separately from SMS and video, allowing a linked text sale without allocating media.
- Dashboard exposes POST `/api/chat/session` and `/api/chat/message` through the existing Pages proxy. A guest receives an isolated, signed two-hour chat capability; a linked lead requires its existing customer capability. The chat capability is bound to its conversation, contact and revocation version. A guest cannot invoke commerce actions.
- Guests get conversation records without creating CRM leads. Linking a guest thread to a lead requires both the guest capability and the lead's customer capability. Text history and conversation ID survive linking.
- Successful customer/assistant exchanges persist as `chat` messages in the existing dashboard store. Request IDs replay a saved response and reject reuse with different text. The browser preserves the request ID after a failed attempt. Provider failure creates no successful exchange. This is persisted retry handling, not a claim of cross-isolate exactly-once delivery; atomic concurrency enforcement remains Stage 5.
- The text adapter receives current server-side commerce context and bounded stored history. It cannot execute provider actions through generated text. Product selection, DocuSign status and delivery use the existing signed action endpoint. Only message normalization accepts `chat`; SMS/email provider selection remains unchanged.
- Video receives the same authenticated contact, current commerce state and combined text/video history. The resume prompt includes recent conversation context. Restored text is displayed without being uploaded again as video transcript.
- Closing/reopening retains credentials in tab-scoped session storage. Expired guest sessions require a fresh conversation; a still-valid customer capability can reopen its linked history. There is no public history lookup by contact ID alone.
- Video allocation, client loading, avatar-join or microphone failure leaves text available. Closing during allocation invalidates pending UI work. Guest video still does not save a contact-linked media transcript; complete preferences to link sales and media history.

## Validation

- `node --experimental-strip-types scripts/test-video-commerce.mjs`: real Pages/dashboard/Concierge/sealed adapter handlers with SQLite and external edges stubbed. Covers independent text, guest isolation/linking, forged histories/capabilities, retry IDs, commerce using the text workflow token, media handoff, restored history and text during media failure, plus the prior document/signature/delivery regression.
- `node scripts/test-buddy-messaging-ui.mjs`: executes the shipped UI with DOM/media/network doubles. Covers no LiveKit on text, video and microphone failure fallback, draft recovery, upgrade, transcript deduplication, reopening and closing during allocation. This is not browser layout or live-media acceptance.
- `node scripts/test-buddy-security.mjs`: 44 production security checks including the new public route/method/CORS boundaries.
- Dashboard suite: 127 assertions. Dashboard Wrangler dry-run bundle passes. Frontend TypeScript/Vite build, 74-import Worker bundle boundary, legacy video checks and all 12 sealed hashes pass.
- A real Chromium run was unavailable in this workspace; the browser download failed. Real browser/provider acceptance remains required before release.

## Deployment and configuration gate

No Cloudflare deployment or secret mutation was performed. Cloudflare account-management tools are not exposed in this session despite the connection being enabled in the user's settings. Installed-app permission is not evidence that deployed bindings were inspected.

1. Keep Pass 2's Access, HMAC, scoped internal authentication and provider requirements. Deploy Buddy's dashboard before Pages so the text endpoints exist before the UI requests them. This pass adds no resource names or database tables.
2. Confirm the existing `ASSISTANT` binding targets `buddys-assistant-adapter`, the adapter's `BLACKHOLE_RUNTIME_TOKEN` resolves, and the dashboard's existing `INTERNAL_CALL_SECRET` matches the Buddy services that use it. Consume existing account secrets; do not overwrite a deployed secret based on an unverified name match.
3. The screenshots identify Secrets Store `00b34d29f2c94685b0f250dc5b1ee875`. They show names, not verified Worker bindings. `XYZ_DEMO_RUNTIME_TOKEN` and `XYZ_DEMO_EILA_RUNTIME_TOKEN` must not be assumed to equal `INTERNAL_CALL_SECRET`. DocuSign Connect HMAC and RSA private key presence remain unverified. Enter missing values through Cloudflare's secret input, never repository files or chat.
4. Verify in a real browser: Message Buddy works without a media request; preferences link prior guest messages; two products can be selected in text; signing and delivery resume after a video upgrade; denied microphone and unavailable avatar preserve text; closing/reloading restores the authorized conversation.
5. Record deployed commits and controlled live-provider results under Stage 7. The unchanged sealed adapter does not require redeployment for this code pass; use the secure Pass 2 wrapper if its Access configuration still needs deployment.

Next is Stage 4: structured two-product showroom cards and expanded details using approved product facts/assets. Capacity, telemetry, release acceptance and Unreal follow in the order documented in FINALIZATION-STAGES.md.
