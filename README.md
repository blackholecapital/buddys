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
  -> LiveKit room + LemonSlice avatar
  -> Buddy/eila-runtime voice provider
```

LemonSlice agent: `agent_9f9ee92bbcec14c3`.

The browser receives only the short-lived LiveKit room URL/token. LemonSlice and Black Hole capability credentials remain server-side.

## Pass 1 deployment prerequisites

Set the following Cloudflare secret on the Buddy concierge worker:

```bash
npx wrangler secret put BLACKHOLE_CAPABILITY_TOKEN
```

The value must match the deployed `blackhole-video-worker` capability token. The internal service binding is already represented in `apps/blackhole-concierge-worker/wrangler.toml`.

Optional non-secret overrides:

- `BUDDY_LEMONSLICE_AGENT_ID`
- `BUDDY_VIDEO_VOICE_PROVIDER` (default `eila-runtime`)
- `BUDDY_VIDEO_VOICE_MODEL`
- `BUDDY_VIDEO_VOICE_ID` (default `buddy`)
- `BUDDY_AVATAR_PROMPT`

## Source lineage

Initial application snapshot copied from Alley Concierge `main` commit `d511cda48d3fd6910b1fd22ae2e59997a114839a`.
