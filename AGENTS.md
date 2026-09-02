# Buddy's deployment boundary

> **MANDATORY — READ BEFORE CHANGING OR DEPLOYING THIS REPOSITORY.**

This repository is a sovereign, self-contained product module. It may consume the frozen shared EILA voice/video resource layer through its committed tenant adapter, but it does not own that shared runtime and must never reconfigure another product to make Buddy's work.

## Frozen pipeline

```text
Buddy's UI
  -> Buddy's API / tenant adapter
  -> existing shared session broker contract
  -> LiveKit room
  -> shared avatar worker
  -> shared voice runtime
  -> shared LLM / TTS resources
```

The shared layer is a dependency, not code to copy into this repository. Adding a tenant, creator, voice, or avatar is a configuration/adapter operation and must not require shutting down the shared runtime.

## Allowed here

- Change only Buddy's UI, APIs, data, prompts, tenant metadata, and Buddy's-owned workers.
- Configure the existing tenant ID, capability binding, runtime target, voice ID, avatar source, and prompt through this repository's committed adapter/runbook.
- Deploy only targets explicitly defined in this repository.
- Consume existing account-level secrets by binding name without reading, rotating, or replacing them.
- Use other repositories as read-only architectural references.

## Forbidden

- Do not edit, deploy, bind, or open a PR against `blackholecapital/cloudflare-platform`.
- Do not modify `blackholecapital/EILA-Overwatch`, the shared Windows/WSL runtime, LiveKit avatar worker, shared voice runtime, Ollama, host OS, iOS application, BIOS, GPU configuration, tunnels, or services for a Buddy's feature.
- Do not modify AI Fans, Buddy's, ACE, EBC, Inspections, Guest List, or any other product repository.
- Do not clone the shared runtime, launch a second shared agent, change shared ports, restart shared services, rotate shared tokens, or rename shared bindings during a tenant deployment.
- Do not point Buddy's at another tenant's Worker, database, queue, bucket, token, voice, avatar, or service binding.
- Do not run a plain `wrangler deploy` unless the repository runbook explicitly identifies that exact target.
- Do not treat a shared-runtime outage as permission to widen scope.

## Required deployment flow

1. Read this file and the repository's committed deployment/readiness runbook.
2. Confirm the diff is limited to this repository and Buddy's-owned resource names.
3. Configure or update the tenant adapter; do not change the shared runtime.
4. Run this repository's tests, build, isolation check, and readiness/session smoke test.
5. Deploy only this repository's named Worker/Pages targets in the documented order.
6. Verify the tenant ID and room/session metadata resolve to Buddy's.
7. If LiveKit opens but the avatar does not join for multiple tenants, stop. That is a shared-runtime incident. Diagnose/recover it from the EILA runtime owner repository; do not patch around it here.

## Stop condition

If the requested work appears to require any cross-repository, shared-runtime, host-machine, or central-platform change, stop and obtain explicit owner authorization. The default answer is an adapter inside this repository—not a modification elsewhere.
