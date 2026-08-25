# Blackhole Voice Worker

Source-controlled Cloudflare Worker for Buddy/Alley outbound voice calls.

## Current responsibility

- `GET /health` service health and realtime-mode status
- `POST /internal/calls` receive resolved concierge lead context and originate a Twilio call
- require `x-internal-call-secret` for paid call origination
- `POST /twilio/status` receive Twilio call lifecycle callbacks
- `POST /twilio/stream-status` receive Media Stream lifecycle callbacks
- `GET /twilio/media` upgrade Twilio to a bidirectional WebSocket Media Stream
- stream Twilio's raw mulaw/8000 customer audio into Deepgram realtime STT when configured
- emit final transcripts and lifecycle events to `blackhole-communication-events`
- write voice telemetry to `blackhole_voice_events`

## Realtime path

`/internal/calls` uses `<Connect><Stream>` when `MEDIA_STREAM_URL` is configured. Twilio connects to `/twilio/media` and sends raw base64 mulaw/8000 audio frames. The worker decodes those frames and forwards the bytes to Deepgram's realtime Listen WebSocket.

The Twilio stream includes compact custom parameters:

- `contactId`
- `firstName`
- `interest`
- `location`
- `leadScore`

Final Deepgram transcript events are logged and emitted as `stt.transcript.final`. This is the speech-input half of the voice loop. LLM routing and TTS audio return are the next layer.

## Required Cloudflare secrets

Set remotely with Wrangler. Never commit values.

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `INTERNAL_CALL_SECRET`
- `DEEPGRAM_API_KEY` for realtime transcription

`INTERNAL_CALL_SECRET` must match across dashboard, concierge, and voice workers.

## Non-secret variables

- `PUBLIC_BASE_URL`
- `MEDIA_STREAM_URL`
- `DEEPGRAM_STT_MODEL` default `nova-3`
- `DEEPGRAM_ENDPOINTING_MS` default `300`

## Deploy

```bash
cd apps/voice-worker
npx wrangler deploy
```

## Realtime verification

Tail the worker before placing a real Buddy call:

```bash
npx wrangler tail blackhole-voice-worker
```

Expected progression:

1. Twilio call status reaches in-progress.
2. `Twilio media stream started` appears with call, stream, contact, and mulaw/8000 metadata.
3. `Deepgram STT connected` appears when `DEEPGRAM_API_KEY` is configured.
4. Customer speech produces `Deepgram transcript` log entries and final `stt.transcript.final` events.
5. Stream close reports media chunk/byte and transcript counts.
