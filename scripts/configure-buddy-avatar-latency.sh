#!/usr/bin/env bash
set -euo pipefail

agent_dir="${BUDDY_AVATAR_AGENT_DIR:-/workspace/repos/cloudflare-platform/shared/livekit-avatar-agent}"
env_file="${BUDDY_AVATAR_AGENT_ENV:-${agent_dir}/.env}"
service_name="${BUDDY_AVATAR_SERVICE:-blackhole-avatar.service}"

if [[ ! -d "${agent_dir}" || ! -f "${env_file}" ]]; then
  echo "Avatar agent or .env not found: ${agent_dir}" >&2
  exit 1
fi

backup="${env_file}.bak-latency-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "${env_file}" "${backup}"

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

probe_runtime() {
  curl -fsS --max-time 2 "$1/health" >/dev/null 2>&1
}

runtime_url=""
for candidate in "http://127.0.0.1:8010"; do
  if probe_runtime "${candidate}"; then
    runtime_url="${candidate}"
    break
  fi
done

if [[ -z "${runtime_url}" ]] && command -v wsl.exe >/dev/null 2>&1; then
  ai_ip="$(wsl.exe -d AI-Linux -- hostname -I 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  if [[ -n "${ai_ip}" ]] && probe_runtime "http://${ai_ip}:8010"; then
    runtime_url="http://${ai_ip}:8010"
  fi
fi

if [[ -z "${runtime_url}" ]]; then
  runtime_url="https://buddy-voice.xyz-labs.xyz"
  echo "WARNING: direct Buddy runtime was unreachable; retaining the public Cloudflare route." >&2
else
  echo "Buddy avatar will bypass the public tunnel: ${runtime_url}"
fi

if ! grep -qE '^(BLACKHOLE_BUDDYS_RUNTIME_TOKEN|BUDDY_RUNTIME_TOKEN|EILA_RUNTIME_TOKEN)=.+' "${env_file}"; then
  echo "Buddy runtime token is missing from the avatar agent .env" >&2
  exit 1
fi

upsert_env BLACKHOLE_BUDDYS_RUNTIME_URL "${runtime_url}"
upsert_env EILA_LIVEKIT_STREAMING_TTS true

current_llm_base="$(sed -n 's/^LOCAL_LLM_BASE_URL=//p' "${env_file}" | tail -1)"
if [[ -n "${current_llm_base}" ]]; then
  tags_url="${current_llm_base%/v1}/api/tags"
  if curl -fsS --max-time 4 "${tags_url}" 2>/dev/null | grep -q '"qwen3.5:9b"'; then
    upsert_env LOCAL_LLM_MODEL qwen3.5:9b
    echo "Buddy LiveKit LLM set to the available qwen3.5:9b model."
  else
    echo "Current LiveKit LLM host does not advertise qwen3.5:9b; model selection left unchanged."
  fi
fi

sudo systemctl restart "${service_name}"
sleep 4
sudo systemctl is-active --quiet "${service_name}"
sudo journalctl -u "${service_name}" -n 20 --no-pager | grep -E 'registered worker|TTS_SOURCE|ERROR' || true

echo "Buddy avatar streaming latency settings applied."
echo "Backup: ${backup}"
