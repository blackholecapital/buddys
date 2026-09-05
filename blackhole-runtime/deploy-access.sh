#!/usr/bin/env bash
# Buddy-owned deployment wrapper: preserve the sealed kit and enforce Access settings.
set -euo pipefail
BUDDY_KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BUDDY_KIT_DIR"
npm run validate
BUDDY_CONFIG="$(mktemp "$BUDDY_KIT_DIR/.wrangler-access.XXXXXX.json")"
trap 'rm -f "$BUDDY_CONFIG"' EXIT
node --input-type=module - "$BUDDY_CONFIG" <<'JS'
import fs from 'node:fs';
const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
if(config.name!=='buddys-assistant-adapter')throw new Error('Wrong deployment target');
config.vars.SETTINGS_AUTH_MODE='access';
fs.writeFileSync(process.argv[2],JSON.stringify(config,null,2));
JS
npx --yes wrangler@4.126.0 deploy --config "$BUDDY_CONFIG"
curl --fail --silent --show-error --max-time 20 https://buddys-assistant.xyz-labs.xyz/health
