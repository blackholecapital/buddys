#!/usr/bin/env bash
# Named Buddy-only release. Does not deploy the Command Center or shared runtime.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm run validate --prefix blackhole-runtime
node scripts/test-buddy-messaging-ui.mjs
# Check the already-published scene before enabling its registered selection.
buddy_scene_check="$(mktemp)"
trap 'rm -f "$buddy_scene_check"' EXIT
curl --fail --silent --show-error --max-time 30 \
  https://buddys-4nm.pages.dev/buddys/images/buddy-show.PNG -o "$buddy_scene_check"
node --input-type=module - "$buddy_scene_check" <<'JS'
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync('blackhole-runtime/src/tenant.manifest.json','utf8'));
const expected=manifest.assistants.find(a=>a.assistant_id==='buddy').avatar_variants.showroom.sha256;
const actual=createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex');
if(actual!==expected)throw Error('Published showroom image does not match the registered asset. Publish the current frontend first.');
JS
# Preserve deployed ordinary variables, including settings authentication mode.
(cd blackhole-runtime && npx --yes wrangler@4.126.0 deploy --keep-vars --config wrangler.jsonc)
bash scripts/deploy-buddy-customer.sh
printf '\nShowroom release deployed. Open Showroom and click video to verify the standing scene and voice.\n'
