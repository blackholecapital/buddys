# BB showroom preview

`/bb-demo/` is a standalone, client-side concept demo linked below Buddy's CRM in the operator sidebar. The operator title is now AI Concierge.

Six occasion filters, outfit image selection and persisted favorite hearts are interactive. The header, rewards and bag are static display content. Prices and fashion designs are illustrative. There is no checkout or customer-data submission.

The live stylist is intentionally pending, with disabled chat/voice/video inputs and a PREVIEW indicator. The existing sealed adapter declares only Buddy and enforces Buddy's identity. No requests are sent to that assistant from this demo. To complete live AI, the runtime owner must register a separate bebe assistant and approved Eila voice through the tenant contract. AGENTS.md requires explicit owner authorization for cross-repository changes. No shared runtime, credentials, voice bindings or sealed kit files were changed.

## Artwork

`apps/frontend/public/bb-demo/catalog.png` was generated using the built-in image-generation tool. It is a concept fashion atlas, not official bebe inventory or photography. The supplied screenshot guided the layout; its embedded controls are not reused as interface images. SVG viewports isolate atlas cells and preserve model proportions.

Final generation prompt: A clean 4-column, 2-row catalog atlas with an adult brunette model in a warmly lit brown boutique. Six full-body modest formal outfits: black cocktail dress, sequin blazer ensemble, rose satin dress, powder-blue midi dress, black wide-leg jumpsuit, champagne evening gown. Two business-attired stylist portraits. No text, icons, UI or logos. An earlier reference-based generation was rejected, so the final artwork uses this more conservative catalog treatment.

## Verification

```bash
npm run build --prefix apps/frontend
BUDDY_CHROMIUM_PATH=/path/to/chromium node scripts/test-bb-demo.mjs
node blackhole-runtime/scripts/validate-kit.mjs
```

Browser checks cover image swapping, occasion filters, favorite toggling, disabled live inputs and horizontal overflow at desktop, tablet and phone widths. Production build copies the standalone page and local atlas into Pages output. This change does not deploy anything or activate a live assistant.
