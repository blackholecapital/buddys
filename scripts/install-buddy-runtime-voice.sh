#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="${BUDDY_RUNTIME_DIR:-/workspace/repos/EBC/apps/eila-voice-runtime}"
source_wav="${BUDDY_VOICE_SOURCE:-${repo_root}/buddy-chatterbox-test.wav}"
target_dir="${runtime_dir}/assets/voices/buddy"
target_wav="${target_dir}/reference.wav"

if [[ ! -d "${runtime_dir}" ]]; then
  echo "Buddy runtime directory not found: ${runtime_dir}" >&2
  echo "Set BUDDY_RUNTIME_DIR to the deployed eila-voice-runtime directory." >&2
  exit 1
fi

if [[ ! -f "${source_wav}" ]]; then
  echo "Buddy reference voice not found: ${source_wav}" >&2
  exit 1
fi

python3 - "${source_wav}" <<'PY'
import sys
import wave

path = sys.argv[1]
with wave.open(path, "rb") as wav:
    channels = wav.getnchannels()
    sample_width = wav.getsampwidth()
    sample_rate = wav.getframerate()
    seconds = wav.getnframes() / sample_rate

if channels != 1 or sample_width != 2 or sample_rate != 24000 or seconds < 3:
    raise SystemExit(
        f"Buddy reference must be mono PCM16 24 kHz and at least 3 seconds; "
        f"got channels={channels}, width={sample_width}, rate={sample_rate}, duration={seconds:.2f}s"
    )
print(f"Buddy reference validated: mono PCM16 24 kHz, {seconds:.2f}s")
PY

install -d -m 0755 "${target_dir}"
install -m 0644 "${source_wav}" "${target_wav}"

echo "Installed Buddy reference voice: ${target_wav}"
echo "Restart the EILA voice runtime, then run: node scripts/smoke-buddy-runtime.mjs"
