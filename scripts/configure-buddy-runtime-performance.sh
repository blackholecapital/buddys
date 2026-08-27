#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${BUDDY_RUNTIME_DIR:-/workspace/repos/EBC/apps/eila-voice-runtime}"
env_file="${BUDDY_RUNTIME_ENV:-${runtime_dir}/.env}"

if [[ ! -d "${runtime_dir}" || ! -f "${env_file}" ]]; then
  echo "Buddy runtime or .env not found: ${runtime_dir}" >&2
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

upsert_env EILA_LLM_THINK false
upsert_env EILA_LLM_KEEP_ALIVE -1
upsert_env EILA_LLM_NUM_PREDICT 64
upsert_env EILA_LLM_NUM_CTX 3072
upsert_env EILA_PHRASE_MIN_WORDS 2
upsert_env EILA_PHRASE_FIRST_MAX_WORDS 4
upsert_env EILA_PHRASE_TARGET_WORDS 5
upsert_env EILA_PHRASE_MAX_WORDS 14
upsert_env EILA_AUDIO_CHUNK_MS 60

python_candidates=(
  "${runtime_dir}/.venv/bin/python"
  "/workspace/repos/ace-call-center/apps/eila-voice-runtime/.venv/bin/python"
)
gpu_python=""
for candidate in "${python_candidates[@]}"; do
  if [[ -x "${candidate}" ]] && "${candidate}" -c 'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)' 2>/dev/null; then
    gpu_python="${candidate}"
    break
  fi
done

if [[ -n "${gpu_python}" ]]; then
  upsert_env EILA_TTS_DEVICE cuda
  gpu_name="$("${gpu_python}" -c 'import torch; print(torch.cuda.get_device_name(0))' 2>/dev/null || true)"
  echo "Buddy Chatterbox GPU enabled: ${gpu_name:-CUDA/ROCm device 0}"
else
  echo "WARNING: this runtime's PyTorch build cannot see CUDA/ROCm; leaving EILA_TTS_DEVICE unchanged." >&2
  echo "Buddy will remain CPU-bound until the GPU-enabled PyTorch runtime is installed." >&2
fi

echo "Buddy runtime latency settings updated: ${env_file}"
echo "Backup: ${backup}"
echo "Restart the port-8000 EILA runtime, then run scripts/benchmark-buddy-latency.mjs."
