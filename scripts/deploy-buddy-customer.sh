#!/usr/bin/env bash
# Complete customer release: commerce catalog + avatar prompt + Pages UI.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm ci --prefix apps/frontend
npm run build --prefix apps/frontend
if python3 -c 'import tomllib' >/dev/null 2>&1; then
  python3 scripts/deploy-buddy-bindings.py --apply
else
  buddy_deploy_deps=$(mktemp -d)
  trap 'rm -rf "$buddy_deploy_deps"' EXIT
  python3 -m pip install --target "$buddy_deploy_deps" 'tomli==1.2.3'
  PYTHONPATH="$buddy_deploy_deps${PYTHONPATH:+:$PYTHONPATH}" python3 -c 'import sys, runpy, tomli; sys.modules["tomllib"] = tomli; runpy.run_path("scripts/deploy-buddy-bindings.py", run_name="__main__")' --apply
fi
cd apps/frontend
npx --yes wrangler@4.126.0 pages deploy dist --project-name buddys --branch main
printf '\nBuddy customer release deployed: dashboard, Concierge and Pages.\n'
