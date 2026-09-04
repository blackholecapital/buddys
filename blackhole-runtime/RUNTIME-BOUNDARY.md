# Shared AI runtime boundary

This product is a tenant of `blackholecapital/AI-Agent-Command-Center`.

## Allowed here

- Product UI and business logic.
- Tenant API adapter implementing the canonical endpoints.
- Identity metadata, avatar image, normalized reference WAV, and voice ID.
- Tenant-owned health endpoint and deployment targets.
- Invocation of the canonical `/settings/api/assistant-settings` contract for this tenant's declared assistants only.

## Forbidden here

- Shared Windows runtime, WSL services, Ollama, DirectML, LiveKit worker, shared video broker, tunnel, shared ports, provider credentials, or another tenant.
- `cloudflare-platform` changes or deployments.
- A second runtime, avatar agent, tunnel, or model endpoint.
- Direct calls to runtime administration endpoints; voice activation must pass through the unmodified tenant adapter contract.
- Any deployment command that leaves this repository.

## Failure decision

Check the Command Center dashboard first. If the shared plane is green, fix only this repository. If multiple tenants and the shared plane are red, stop and open a Command Center incident; do not patch around it here.

## Required contract

- `GET /health`
- `POST /api/chat`
- `POST /api/video/session`
- `POST /settings/api/assistant-settings`
- Adapter version `1.1.0`
- Shared plane id `blackhole.shared-ai`
