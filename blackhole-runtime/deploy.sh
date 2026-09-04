#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

npm run validate
if ! npx --yes wrangler@4.126.0 r2 bucket info "buddys-assistant-assets" >/dev/null 2>&1; then
  npx --yes wrangler@4.126.0 r2 bucket create "buddys-assistant-assets"
fi
npx --yes wrangler@4.126.0 deploy
curl --fail --silent --show-error --max-time 20 "https://buddys-assistant.xyz-labs.xyz/health"
printf '
Tenant adapter deployed. Settings: https://buddys-assistant.xyz-labs.xyz/settings.html
'
