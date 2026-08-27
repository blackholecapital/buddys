# Buddy's AI Personal Shopper

Dedicated Buddy's Home Furnishings demo repository, split from `blackholecapital/alley-concierge` so Buddy-specific work can evolve without changing the reusable Alley Concierge product.

## Customer demo paths

- Lead-assisted video: customer completes `/buddys/`, selects **Live Video**, and the saved product/store context is passed into Buddy's video session.
- Instant video: customer selects **Start Live Video Chat** without completing the form.
- Existing phone, SMS, email, DocuSign, and Google Calendar paths remain present.

## Video architecture

```
Buddy web page
  -> /api/video/session
  -> dashboard worker
  -> Buddy concierge worker
  -> blackhole-video-worker
  -> LiveKit `lemonslice` agent + LemonSlice image avatar
  -> Buddy/eila-runtime voice provider
```

The production default mirrors AI Fans and uses the public Buddy portrait at
`https://buddys.pages.dev/buddys/images/buddy-avatar.jpg` as a LemonSlice `image-url` source. The saved LemonSlice agent `agent_9f9ee92bbcec14c3` remains available as an explicit fallback, but is not the default.

The browser receives only the short-lived LiveKit room URL/token. LemonSlice and Black Hole capability credentials remain server-side.

The Buddy concierge performs a live runtime preflight before it creates a paid avatar room. A session is rejected unless Qwen chat is configured and the `buddy` Chatterbox voice is both available and prepared.

## Install Buddy's runtime voice

The selected Buddy Chatterbox reference is tracked as `buddy-chatterbox-test.wav`. Install it into the deployed voice runtime from this repository:

```bash
bash scripts/install-buddy-runtime-voice.sh
```

Restart the EILA voice runtime, then verify health, Qwen chat, and LiveKit PCM TTS:

```bash
BUDDY_RUNTIME_TOKEN='<configured runtime token>' node scripts/smoke-buddy-runtime.mjs
```

The unauthenticated readiness status is also available at `/api/video/readiness` on the Buddy concierge Worker. It exposes configuration state only, never credentials.


## Live-video latency tuning

Buddy's fastest path keeps Qwen and the Buddy voice warm, streams phrase-progressive PCM, and sends the avatar agent directly to the home runtime instead of round-tripping each spoken turn through the public Cloudflare Tunnel.

On **AI-Linux**, apply the safe runtime settings and restart the EILA runtime:

```bash
bash scripts/configure-buddy-runtime-performance.sh
```

On the **Ubuntu-22.04 avatar-agent distro**, select the fastest reachable Buddy runtime, enable streaming TTS, and restart the systemd-owned LiveKit worker:

```bash
bash scripts/configure-buddy-avatar-latency.sh
```

The agent script preserves a timestamped `.env` backup and never prints runtime credentials. It uses the direct port-8010 path only when a two-second health probe succeeds; otherwise it retains the public Buddy URL.

Measure the complete local LLM and TTS path after both restarts:

```bash
BUDDY_RUNTIME_TOKEN='<configured runtime token>' node scripts/benchmark-buddy-latency.mjs
```

The acceptance target is first audio below 800 ms p50 and 1.2 seconds p95. A health response that reports `"device":"cpu"` identifies Chatterbox as CPU-bound; the tuning script switches to `cuda` only when the deployed PyTorch build confirms CUDA/ROCm is available.

## Pass 2 deployment

Buddy-specific Worker, D1, Queue, and Analytics Engine names are now declared in the Wrangler configs. The phone voice worker uses `https://alley-voice.xyz-labs.xyz`; browser video is dispatched to the LiveKit agent named `lemonslice` with `eila-runtime:buddy` voice metadata.

Follow [PASS2-DEPLOYMENT.md](./PASS2-DEPLOYMENT.md) to provision the two D1 databases, create the queues, bootstrap Worker names, set secrets, deploy, and smoke test.

The Buddy concierge requires:

Set the following Cloudflare secret on the Buddy concierge worker:

```bash
npx wrangler secret put BLACKHOLE_CAPABILITY_TOKEN
```

The value must match the deployed `blackhole-video-worker` capability token. The internal service binding is already represented in `apps/blackhole-concierge-worker/wrangler.toml`.

Optional non-secret overrides:

- `BUDDY_LIVE_SOURCE` (default `image-url`)
- `BUDDY_AVATAR_IMAGE_URL`
- `BUDDY_LEMONSLICE_AGENT_ID`
- `BUDDY_VIDEO_VOICE_PROVIDER` (default `eila-runtime`)
- `BUDDY_VIDEO_VOICE_MODEL`
- `BUDDY_VIDEO_VOICE_ID` (default `buddy`)
- `BUDDY_RUNTIME_URL` (default `https://alley-voice.xyz-labs.xyz`)
- `BUDDY_AVATAR_PROMPT`

## Source lineage

Initial application snapshot copied from Alley Concierge `main` commit `d511cda48d3fd6910b1fd22ae2e59997a114839a`.
