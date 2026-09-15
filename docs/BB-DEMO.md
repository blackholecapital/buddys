# BB showroom

`/bb-demo/` is linked below Buddy's CRM. Six outfit photos swap into the center frame, occasion links filter the selection, and favorite hearts persist. The header, rewards and bag remain static.

The four bebe-*.png assets are unchanged copies of the user's supplied catalog screenshots. SVG viewports frame the actual photos; neutral covers hide catalog labels at crop edges. The pink-suit model is the assistant portrait. The generated atlas has been removed. Detail is limited by screenshot resolution.

Names and prices transcribed from supplied captures (not a live pricing feed):

| Product | Price |
|---|---:|
| Cascade High Low Mesh Dress | $104.30 |
| Bandage Halter Dress | $117.60 |
| Printed Satin Maxi Dress | $68.60 |
| Marseille Lace Square Neck Tank Dress | $96.99 |
| Ombre Bandage Strapless | $117.60 |
| Cap Sleeve Bandage Mini Dress | $118.30 |

Static bag total: $221.90. The interface notes that offers may change.

The showroom includes a deterministic demo stylist: typed messages, occasion selections, and outfit selections produce polished scripted replies with assistant/customer avatars. This is intentionally local presentation logic; live LLM, voice, and video still require separate assistant registration. It changes no runtime bindings or sealed files.

Validation: frontend production build and scripts/test-bb-demo.mjs (image swaps, filters, hearts, demo chat, avatar bubbles, overflow at 1672/1024/390px). No deployment.
