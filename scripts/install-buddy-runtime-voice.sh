#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="${BUDDY_RUNTIME_DIR:-/workspace/repos/EBC/apps/eila-voice-runtime}"
source_wav="${BUDDY_VOICE_SOURCE:-${repo_root}/buddy-kokoro-test.wav}"
target_dir="${runtime_dir}/assets/voices/buddy"
target_wav="${target_dir}/reference.wav"

if [[ ! -d "${runtime_dir}" ]]; then
  echo "Buddy runtime directory not found: ${runtime_dir}" >&2
  echo "Set BUDDY_RUNTIME_DIR to the deployed eila-voice-runtime directory." >&2
  exit 1
fi

if [[ ! -f "${source_wav}" ]]; then
  echo "Buddy male reference voice not found: ${source_wav}" >&2
  exit 1
fi

install -d -m 0755 "${target_dir}"

python3 - "${source_wav}" "${target_wav}" <<'PY'
import math
import sys
import wave

source, target = sys.argv[1:3]
with wave.open(source, "rb") as wav:
    channels = wav.getnchannels()
    sample_width = wav.getsampwidth()
    sample_rate = wav.getframerate()
    frame_rate = wav.getframerate()
    frames = wav.readframes(wav.getnframes())
    frame_count = wav.getnframes()

seconds = frame_count / sample_rate
if channels != 1 or sample_width != 2 or sample_rate != 24000:
    raise SystemExit(
        "Buddy reference must be mono PCM16 24 kHz; "
        f"got channels={channels}, width={sample_width}, rate={sample_rate}"
    )

# Chatterbox requires a prompt longer than five seconds. The selected Buddy
# male audition is intentionally short, so repeat its PCM frames at install
# time without changing pitch, sample rate, or the source asset in Git.
repeats = max(1, math.ceil(8.0 / seconds))
with wave.open(target, "wb") as wav:
    wav.setnchannels(channels)
    wav.setsampwidth(sample_width)
    wav.setframerate(frame_rate)
    wav.writeframes(frames * repeats)

installed_seconds = seconds * repeats
if installed_seconds <= 5:
    raise SystemExit(f"Installed Buddy reference is too short: {installed_seconds:.2f}s")
print(
    f"Buddy male reference installed: mono PCM16 24 kHz, "
    f"{installed_seconds:.2f}s ({repeats}x selected audition)"
)
PY

chmod 0644 "${target_wav}"

echo "Installed Buddy male reference voice: ${target_wav}"
echo "Restart the EILA voice runtime, then run: node scripts/smoke-buddy-runtime.mjs"
