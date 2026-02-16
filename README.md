# E-Learning Video Builder MVP

Monorepo with a local Next.js app and a cloud Express API. This DEV loop wires health checks and a jobs loop.

## UI Authority (binding)
All UI work must follow the binding UI spec: `docs/ui_spec_v0.1.md`.

## Contributing / Working with Codex
- Any UI change must comply with `docs/ui_spec_v0.1.md`.

## DOCX Upload Limit (local)
The local app validates DOCX size client-side.

Defaults:
- Max size: 300 MB
- Warning threshold: 120 MB

Override via env (client-side):
- `MAX_DOCX_BYTES` or `NEXT_PUBLIC_MAX_DOCX_BYTES`
- `LARGE_DOCX_WARN_BYTES` or `NEXT_PUBLIC_LARGE_DOCX_WARN_BYTES`
- Legacy MB overrides (still supported): `NEXT_PUBLIC_EVB_MAX_DOCX_MB`, `NEXT_PUBLIC_EVB_WARN_DOCX_MB`

## Requirements
- Node.js 18+
- Yarn classic
- Docker (for Redis)

## Install
```bash
yarn install
```

## Demo / Dev (one command)
Run the full local stack (cloud solo + local UI) without Docker:
```bash
yarn dev:demo
```
The script selects free ports if defaults are busy, prints the final URLs, and confirms the cloud instanceId/mode.

Solo mode runs the cloud API and worker in a single process with in-memory queue/store (no Redis).

Quick verification:
- Create project
- Upload a small DOCX
- Approve
- Generate
- Preview plays with captions
- Export ZIP downloads

## Jobs loop requires Redis
Run Redis locally for the async job queue.

## Run jobs loop
1) Start Redis
```bash
docker compose up -d
```
2) Copy env examples
```bash
copy apps\\cloud\\.env.example apps\\cloud\\.env
copy apps\\local\\.env.local.example apps\\local\\.env.local
```
2b) Dev no-Redis mode (single process)
```bash
yarn workspace @evb/cloud dev:solo
```
This starts API + worker in one process using in-memory job store/queue.
Make sure `NEXT_PUBLIC_CLOUD_API_BASE_URL=http://localhost:4000` is set in `apps/local/.env.local`.
3) Set cloud provider (optional, defaults to stub)
```bash
set AVATAR_PROVIDER=stub
```
3) Install dependencies
```bash
yarn install
```
4) Run both apps
```bash
yarn dev
```
5) Open http://localhost:3001/job-demo

## Run individually
```bash
yarn dev:local
yarn dev:cloud
```

## Health check
- Cloud: http://localhost:4000/v1/health
- Local UI: http://localhost:3001/health-check

## Verify
```bash
curl http://localhost:4000/v1/health
```
Open http://localhost:3001/health-check

## Job demo
Open http://localhost:3001/job-demo to submit a job and watch progress.
Use "Start Failing Job" to trigger a failed state and test retry.

## Jobs smoke script
```bash
yarn workspace @evb/cloud smoke:jobs
```

## Cloud tests (Redis optional)
Default cloud tests do not require Redis:
```bash
yarn workspace @evb/cloud test
```
To run Redis-backed tests:
1) Start Redis (docker compose up -d or local redis)
2) Set REDIS_URL (e.g., redis://127.0.0.1:6379)
3) Run:
```bash
yarn workspace @evb/cloud test:redis
```
