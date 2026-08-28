#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root inside AI-Linux." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_dir="${repo_root}/apps/livekit-avatar-agent"
env_file="${app_dir}/.env"
service_name="buddys-avatar.service"
service_file="/etc/systemd/system/${service_name}"
service_user="${BUDDY_AVATAR_USER:-daddy}"
log_dir="${BUDDY_AVATAR_LOG_DIR:-/workspace/logs}"
log_file="${log_dir}/buddys-avatar.log"
source_env="${BUDDY_AVATAR_SOURCE_ENV:-}"

if ! command -v systemctl >/dev/null 2>&1 || [[ "$(ps -p 1 -o comm=)" != "systemd" ]]; then
  echo "AI-Linux must be running with systemd as PID 1." >&2
  exit 1
fi
if ! id "${service_user}" >/dev/null 2>&1; then
  echo "Service user does not exist: ${service_user}" >&2
  exit 1
fi

install -d -o "${service_user}" -g "$(id -gn "${service_user}")" "${log_dir}"

if [[ ! -f "${env_file}" ]]; then
  install -m 600 -o "${service_user}" -g "$(id -gn "${service_user}")" \
    "${app_dir}/.env.example" "${env_file}"
fi

copy_env_value() {
  local key="$1" source_key="${2:-$1}" value
  [[ -n "${source_env}" && -f "${source_env}" ]] || return 0
  value="$(sed -n "s/^${source_key}=//p" "${source_env}" | tail -1)"
  [[ -n "${value}" ]] || return 0
  upsert_env "${key}" "${value}"
}

upsert_env() {
  local key="$1" value="$2" escaped
  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  if grep -q "^${key}=" "${env_file}"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "${env_file}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
  fi
}

# Optional one-time migration from a prior local agent env. This copies values;
# the installed service never imports or executes anything outside this repo.
copy_env_value LIVEKIT_URL
copy_env_value LIVEKIT_API_KEY
copy_env_value LIVEKIT_API_SECRET
copy_env_value BLACKHOLE_BUDDYS_RUNTIME_URL
copy_env_value BLACKHOLE_BUDDYS_RUNTIME_URL BUDDY_RUNTIME_URL
copy_env_value BLACKHOLE_BUDDYS_RUNTIME_TOKEN
copy_env_value BLACKHOLE_BUDDYS_RUNTIME_TOKEN BUDDY_RUNTIME_TOKEN
copy_env_value LOCAL_LLM_BASE_URL
copy_env_value LOCAL_LLM_MODEL
copy_env_value LOCAL_LLM_TEMPERATURE
copy_env_value LIVEKIT_STT_MODEL

upsert_env AGENT_NAME buddys-avatar
upsert_env AGENT_HTTP_PORT 8092
upsert_env BUDDYS_VIDEO_RELAY_URL \
  https://buddys-video-worker.cryptocapitalgroupfl.workers.dev/internal/lemonslice/sessions
upsert_env BUDDY_LIVEKIT_STREAMING_TTS true
upsert_env LOCAL_LLM_BASE_URL "$(sed -n 's/^LOCAL_LLM_BASE_URL=//p' "${env_file}" | tail -1 | sed 's|/$||')"
upsert_env LOCAL_LLM_MODEL "$(sed -n 's/^LOCAL_LLM_MODEL=//p' "${env_file}" | tail -1)"

required_env() {
  local key="$1" value
  value="$(sed -n "s/^${key}=//p" "${env_file}" | tail -1)"
  if [[ -z "${value}" ]]; then
    echo "Missing ${key} in ${env_file}" >&2
    exit 1
  fi
}

required_env LIVEKIT_URL
required_env LIVEKIT_API_KEY
required_env LIVEKIT_API_SECRET
required_env BLACKHOLE_BUDDYS_RUNTIME_URL
required_env BLACKHOLE_BUDDYS_RUNTIME_TOKEN

chown "${service_user}:$(id -gn "${service_user}")" "${env_file}"
chmod 600 "${env_file}"

if [[ ! -x "${app_dir}/.venv/bin/python" ]]; then
  runuser -u "${service_user}" -- python3 -m venv "${app_dir}/.venv"
fi
runuser -u "${service_user}" -- "${app_dir}/.venv/bin/python" -m pip install --upgrade pip
runuser -u "${service_user}" -- "${app_dir}/.venv/bin/python" -m pip install "${app_dir}"

cat > "${service_file}" <<UNIT
[Unit]
Description=Buddy LiveKit Avatar Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${app_dir}
EnvironmentFile=${env_file}
ExecStart=${app_dir}/bin/start.sh
Restart=always
RestartSec=3
StandardOutput=append:${log_file}
StandardError=append:${log_file}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${service_name}"

for _ in $(seq 1 20); do
  if systemctl is-active --quiet "${service_name}" \
    && ss -H -ltn "sport = :8092" 2>/dev/null | grep -q ':8092'; then
    break
  fi
  sleep 1
done

"${app_dir}/bin/health.sh"
echo "Buddy avatar agent installed from ${app_dir}."
echo "Logs: ${log_file}"
