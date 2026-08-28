#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${app_dir}"
exec .venv/bin/python src/agent.py start

