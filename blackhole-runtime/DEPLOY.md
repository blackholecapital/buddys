# Deploy Buddy's

This directory is generated from `blackholecapital/AI-Agent-Command-Center`. Do not rewrite any runtime file.
Every generated file, including `src/index.js`, is sealed by `tenant-kit.lock.json`. Assistant variation is limited to registered identity metadata plus avatar/WAV assets uploaded through the protected settings page.

## Before deployment

1. Confirm the shared runtime health endpoint is green.
2. In Cloudflare Access, protect `buddys-assistant.xyz-labs.xyz/settings*` with the operator allow policy represented by the configured AUD.
3. Confirm the custom hostname belongs to an active Cloudflare zone.
4. Confirm the default Secrets Store contains `XYZ_DEMO_EILA_RUNTIME_TOKEN`.

## Deploy only this tenant

```bash
bash ./deploy.sh
```

Then open `https://buddys-assistant.xyz-labs.xyz/settings.html`, upload the avatar and voice, and run:

```bash
curl --fail --silent --show-error https://buddys-assistant.xyz-labs.xyz/health
```

Do not deploy the Command Center, shared video worker, Windows runtime, tunnel, LiveKit worker, or another tenant from this directory.
