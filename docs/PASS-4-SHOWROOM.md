# Pass 4 — Showroom V1

The shopping workspace now puts two product cards beside a compact Buddy video and messaging panel. Customers can browse categories, expand details, and explicitly select a product to prepare its demo agreement. Guest browsing needs no media allocation. The preferences form connects a guest to the existing authorized sales workflow.

## Catalog and customer behavior

`apps/shared/buddy-catalog.cjs` is the common web/Concierge source for nine categories and eighteen choices. Existing web product IDs remain stable. Bedroom, dining and gaming now receive their own choices instead of matching mattress, living-room or computer fallbacks. Support/financing interests have no invented sellable products; they start in browsing state.

The catalog carries ID, category, description, specifications, illustration metadata, optional product URL/price and version. Facts are limited to existing committed demo catalogs. Twelve repository-owned SVG category illustrations are labeled as illustrations. These are not exact product photographs or a stock feed. Exact photos, dimensions, finishes, availability, product URLs and pricing need store confirmation before customer release. Product URLs/prices are currently null; details provide the existing official store-locator link. The renderer accepts future product links only on Buddy's HTTPS domains.

Category changes persist to both the dashboard contact and Concierge's SMS/contact store. Signed actions cannot change a category once an agreement or scheduled order exists. Product selection sends the rendered product ID and catalog version alongside the index, so stale cards cannot silently select a different item. A second tab cannot change the item on an existing agreement. Questions about an option no longer count as selection intent.

`product.shown` and `product.opened` are signed, catalog-validated UI reports. They are deduplicated per session/product/event and stored in activity with `source: customer-ui`. They are exposure reports, not proof of human attention. `product.selected` is recorded by the server after confirmed agreement sending and deduplicated by envelope. UI callers cannot fabricate this event. Operator funnel presentation remains Stage 6.

## Validation

- Real Chromium at 1280×900, 390×844 and 320×740: guest browsing, category details, Escape/back, preferences handoff, linked category changes, inquiry without agreement creation, explicit selection, events, video failure/text fallback and no horizontal overflow. Screenshots inspected at desktop/mobile. APIs/providers in this browser test are fixtures; it does not establish live media or provider health.
- Expanded real Pages/dashboard/Concierge/sealed-adapter integration with SQLite/provider stubs: correct catalog assets, category persistence, stale ID rejection, agreement category lock, event authorization/deduplication, plus prior text/video/document/signature/delivery checks.
- 127 dashboard assertions; 48 production security checks; messaging lifecycle regression; legacy video regression; 76-import Worker boundary; frontend TypeScript/Vite build; dashboard and Concierge Wrangler dry-run bundles; all 12 sealed hashes unchanged.
- Cloudflare inventory fixture test verifies that raw secret values, plaintext values and comments are excluded and store pagination is followed.

Browser checks can be reproduced with:

```bash
npm ci --prefix scripts/browser
scripts/browser/node_modules/.bin/playwright install --with-deps chromium
node scripts/test-buddy-showroom-browser.mjs
```

An already-installed Chromium can be selected with `BUDDY_CHROMIUM_PATH`. CI uses the pinned Playwright dependency and its matching browser. Local checks used Chromium 131 from a temporary npm browser bundle because the normal browser CDN was unavailable.

## Cloudflare inventory on the SSH server

Run the committed read-only script from an updated Buddy checkout:

```bash
python3 scripts/cloudflare-buddy-inventory.py
```

It uses `CLOUDFLARE_API_TOKEN` if set, otherwise prompts with hidden input. The token needs read access to Worker settings and Secrets Store metadata in the pictured XYZ Labs account. The script only requests settings for the six explicitly named Buddy Workers and metadata in store `00b34d29f2c94685b0f250dc5b1ee875`. It prints required binding presence, safe binding metadata and relevant account secret names. It does not print values, create secrets, alter bindings or deploy code. HTTP failures remain UNVERIFIED, not MISSING.

Send the report back before provisioning. In particular, do not replace `INTERNAL_CALL_SECRET` with an LLM runtime token or assume same-named encrypted Worker secrets contain the same value. A Secrets Store binding needs asynchronous `.get()` support; several existing Buddy provider paths still consume ordinary string secrets, so metadata is needed before prescribing store bindings. Missing expected names do not rule out alternate credentials such as a configured Google access token.

The available code session still has no Cloudflare account tool/authentication. The inventory has been tested with fixtures, not run against the live account. No secrets were changed or deployments performed.

API references: [Worker settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/), [Secrets Store metadata](https://developers.cloudflare.com/api/resources/secrets_store/subresources/stores/subresources/secrets/methods/list/), [Secrets Store bindings](https://developers.cloudflare.com/secrets-store/integrations/workers/).

## Deployment and next stage

After Pass 2's Access/provider prerequisites and existing bindings are verified, deploy Buddy Concierge, dashboard, then Pages. This pass adds no Cloudflare resource. Preserve all shared-runtime boundaries; do not redeploy the sealed adapter for showroom changes. Live acceptance must confirm the same category/product survives signing, video upgrade and delivery scheduling.

Next: Stage 5, the Rate Limits & Capacity panel and atomic enforcement. Stage 6 adds operator telemetry; Stage 7 reconciles deployment configuration and live acceptance; Stage 8 adds Unreal after stable V1.
