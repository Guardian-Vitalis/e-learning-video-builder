Redis Mode (API + Worker split)

Redis mode is optional and off by default. When enabled, Cloud API and Worker can run as separate processes with durable job state.

Start Redis (Windows)
Option A (Docker):
docker run -p 6379:6379 redis:7

Option B (WSL):
Use your existing Redis service inside WSL.

Set environment (PowerShell):
$env:REDIS_URL="redis://127.0.0.1:6379"
$env:EVB_RUN_MODE="split"
$env:EVB_STORE="redis"
$env:EVB_QUEUE="redis"

Set environment (cmd.exe):
set REDIS_URL=redis://127.0.0.1:6379
set EVB_RUN_MODE=split
set EVB_STORE=redis
set EVB_QUEUE=redis

Run demo (split API + worker):
yarn dev:demo:redis

Run Redis tests:
set EVB_RUN_REDIS_TESTS=1
yarn workspace @evb/cloud test --run

Notes
- Redis mode uses worker heartbeats stored in Redis so /v1/health and /v1/worker/heartbeat reflect the worker across processes.
- Redis mode adds job leases + recovery so running jobs are requeued if a worker crashes.

Stuck-job recovery
When a worker starts a job it creates a lease key in Redis. If the worker crashes and the lease expires, another worker will requeue the job on a periodic recovery scan.

Env knobs (defaults)
EVB_JOB_LEASE_MS=60000
EVB_JOB_LEASE_RENEW_MS=20000
EVB_JOB_RECOVERY_SCAN_MS=30000
EVB_JOB_MAX_RETRIES=3

What happens if the worker crashes?
The lease expires, the recovery scan detects the running job without a lease, increments retryCount, and requeues it (up to EVB_JOB_MAX_RETRIES).

Admin endpoints (Redis mode only)
GET /v1/admin/jobs?status=running&limit=50
GET /v1/admin/jobs/:id
GET /v1/admin/jobs/:id/events
POST /v1/admin/recover

Example (PowerShell):
Invoke-RestMethod "$env:NEXT_PUBLIC_CLOUD_API_BASE_URL/v1/admin/jobs?status=running&limit=20"
Invoke-RestMethod "$env:NEXT_PUBLIC_CLOUD_API_BASE_URL/v1/admin/jobs/<jobId>/events"
Invoke-RestMethod -Method Post "$env:NEXT_PUBLIC_CLOUD_API_BASE_URL/v1/admin/recover"

Local Admin panel
In dev mode, open /admin in the Local app to view jobs and run a recovery scan.

Job events timeline
Events are stored in Redis lists: evb:<instanceId>:job:<jobId>:events
Fetch via GET /v1/admin/jobs/:id/events.
