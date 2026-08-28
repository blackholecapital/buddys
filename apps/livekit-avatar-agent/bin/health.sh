#!/usr/bin/env bash
set -euo pipefail

service_name="${BUDDY_AVATAR_SERVICE:-buddys-avatar.service}"
port="${BUDDY_AVATAR_PORT:-8092}"

state="$(systemctl is-active "${service_name}" 2>/dev/null || true)"
pid="$(systemctl show "${service_name}" -p MainPID --value 2>/dev/null || true)"
listener="$(ss -H -ltnp "sport = :${port}" 2>/dev/null || true)"

printf 'service=%s state=%s pid=%s port=%s\n' "${service_name}" "${state:-unknown}" "${pid:-0}" "${port}"
if [[ "${state}" != "active" || -z "${pid}" || "${pid}" == "0" || -z "${listener}" ]]; then
  journalctl -u "${service_name}" -n 30 --no-pager 2>/dev/null || true
  exit 1
fi

printf '%s\n' "${listener}"
if ! journalctl -u "${service_name}" -n 100 --no-pager 2>/dev/null | grep -q 'registered worker'; then
  echo "WARNING: service is listening but no recent LiveKit registration line was found" >&2
fi

