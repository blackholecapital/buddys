# Buddy's Pass 2 deployment

The repository no longer points at Alley Concierge's Worker, D1, Queue, or Analytics Engine names. Run these steps from an authenticated Cloudflare environment.

## 1. Provision isolated data resources

```bash
node scripts/provision-cloudflare.mjs
```

This creates or reuses:

- D1: `buddys-dashboard-db`, `buddys-message-track-db`
- Queues: `buddys-followup-jobs`, `buddys-communication-events`
- Analytics Engine datasets: `buddys_message_events`, `buddys_voice_events` (created automatically on first write)

The script replaces the D1 ID markers in both Wrangler configs.

Before provisioning or deploying, the image-avatar contract can be checked without external services:

```bash
node scripts/test-video-config.mjs
```

## 2. Bootstrap Worker names

Cloudflare requires service-binding targets to exist before their callers deploy. The Buddy voice and concierge Workers call each other, so create harmless stubs first:

```bash
node scripts/bootstrap-workers.mjs
```

## 3. Set secrets

Use the same `INTERNAL_CALL_SECRET` value for dashboard, concierge, and voice. Generate one Buddy-only capability value and store it as `BLACKHOLE_BUDDYS_CAPABILITY_TOKEN` on `buddys-video-worker` and `BLACKHOLE_CAPABILITY_TOKEN` on `buddys-concierge-worker`.

```bash
cd apps/dashboard
npx wrangler@latest secret put INTERNAL_CALL_SECRET

cd ../blackhole-concierge-worker
npx wrangler@latest secret put INTERNAL_CALL_SECRET
npx wrangler@latest secret put BLACKHOLE_CAPABILITY_TOKEN

cd ../video-worker
npx wrangler@latest secret put LIVEKIT_API_KEY
npx wrangler@latest secret put LIVEKIT_API_SECRET
npx wrangler@latest secret put BLACKHOLE_BUDDYS_CAPABILITY_TOKEN
npx wrangler@latest secret put LEMONSLICE_BUDDYS_API_KEY

cd ../voice-worker
npx wrangler@latest secret put INTERNAL_CALL_SECRET
npx wrangler@latest secret put TWILIO_ACCOUNT_SID
npx wrangler@latest secret put TWILIO_AUTH_TOKEN
npx wrangler@latest secret put TWILIO_PHONE_NUMBER
npx wrangler@latest secret put DEEPGRAM_API_KEY
npx wrangler@latest secret put BUDDY_RUNTIME_TOKEN

cd ../sms-worker
npx wrangler@latest secret put TWILIO_ACCOUNT_SID
npx wrangler@latest secret put TWILIO_AUTH_TOKEN
npx wrangler@latest secret put TWILIO_PHONE_NUMBER

cd ../email-worker
npx wrangler@latest secret put RESEND_API_KEY
```

DocuSign and Google Calendar secrets remain optional for the first video smoke test. Set the existing DocuSign/Google values on `buddys-concierge-worker` before testing the complete purchase flow.

## 4. Deploy

Install the tracked Buddy voice reference into the deployed EILA runtime before creating video sessions:

```bash
bash scripts/install-buddy-runtime-voice.sh
# Restart the EILA voice runtime after installation.
BUDDY_RUNTIME_TOKEN='<configured runtime token>' node scripts/smoke-buddy-runtime.mjs
```

Do not continue until the runtime smoke prints PASS for health, chat, and LiveKit TTS.

Install the dedicated avatar service inside AI-Linux. If credentials are still present in an older local env, provide that file through the optional migration variable:

```bash
BUDDY_AVATAR_SOURCE_ENV=/path/to/previous-agent.env \
  bash scripts/install-buddy-avatar-agent.sh
```

```bash
cd apps/sms-worker && npx wrangler@latest deploy
cd ../email-worker && npx wrangler@latest deploy
cd ../voice-worker && npx wrangler@latest deploy
cd ../video-worker && npx wrangler@latest deploy
cd ../blackhole-concierge-worker && npx wrangler@latest deploy
cd ../dashboard && npx wrangler@latest deploy --env=""

cd ../frontend
npm ci
npm run build
npx wrangler@latest pages project create buddys --production-branch main
npx wrangler@latest pages deploy dist --project-name buddys --branch main
```

If the Pages project already exists, skip `pages project create`.

## 5. Runtime and smoke checks

Browser video dispatches to LiveKit `wss://eila-7257eve9.livekit.cloud`, exact agent name `buddys-avatar`, with `voice_provider=eila-runtime` and `voice_id=buddy`. Ensure `buddys-avatar.service` is active and registered before testing.

```bash
curl -fsS https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev/api/health
curl -fsS https://buddys-dashboard-worker.cryptocapitalgroupfl.workers.dev/api/health
curl -fsS https://buddys-voice-worker.cryptocapitalgroupfl.workers.dev/health
curl -fsS https://buddys-video-worker.cryptocapitalgroupfl.workers.dev/health
curl -fsS https://buddys.pages.dev/buddys/images/buddy-avatar.jpg -o /dev/null
curl -fsS https://buddys-concierge-worker.cryptocapitalgroupfl.workers.dev/api/video/readiness
```

Then open `https://buddys.pages.dev/buddys/` and test both paths:

1. **Start Live Video Chat** without a lead form.
2. Submit the lead tile with **Live Video** selected and confirm Buddy receives the saved interest/location context.

Or run the complete public readiness gate from the repository root:

```bash
node scripts/smoke-public.mjs
```

Do not call the demo ready until every check prints `PASS`. The relay check deliberately expects an unauthenticated `401`; that proves the protected Buddy-specific route is deployed without exposing its credential.
