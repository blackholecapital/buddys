# Buddy glass controls, CRM and product photography

This pass affects Buddy-owned presentation and demo catalog imagery only. No deployment, shared runtime, authentication, or tenant binding changes.

- Sales page links to `/buddy-dashboard`; CRM links back to `/buddys/#contact-form`.
- Legacy instant-entry buttons remain hidden because the session controller retains their event bindings. The visible redundant intro is removed.
- Glass-style icons retain accessible action labels; send is an arrow inside the composer. Hidden scrollbars do not disable scrolling.
- Product images are local assets with a static illustration fallback on load failure. All 18 product images are exercised in the browser test.
- `apps/shared/buddy-photo-sources.json` records each downloaded source image and source page. Retrieval date: 2026-09-14. Photographs are representative demo imagery, not verified exact Buddy's inventory. Both cards and details disclose this. The original sectional photograph remains unchanged.
- Public source availability does not transfer image rights. Obtain Buddy's approved product feed/licensed photography before a production catalog launch. Demo weekly estimates remain illustrative, not store quotes.

Validation:

```bash
node scripts/test-video-commerce.mjs
node scripts/test-buddy-messaging-ui.mjs
npm run build --prefix apps/frontend
BUDDY_CHROMIUM_PATH=/tmp/hcs-chromium node scripts/test-buddy-showroom-browser.mjs
BUDDY_CHROMIUM_PATH=/tmp/hcs-chromium node scripts/test-buddy-crm-premium.mjs
node blackhole-runtime/scripts/validate-kit.mjs
```
