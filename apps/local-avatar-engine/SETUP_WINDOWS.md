# Local Avatar Engine Setup (Windows)

1) Run the setup script:

```powershell
apps/local-avatar-engine/scripts/setup-windows.ps1
```

2) Create `apps/local-avatar-engine/.env.local` using the printed values.

3) Start the engine:

```powershell
yarn workspace @evb/local-avatar-engine dev
```

4) Verify readiness:

```powershell
apps/local-avatar-engine/scripts/doctor.ps1
```

5) Smoke test `POST /v1/jobs` from PowerShell (second terminal):

```powershell
# Terminal 1: keep engine running
yarn workspace @evb/local-avatar-engine dev

# Terminal 2:
$payload = @{
  jobId = "smoke-job-1"
  clipId = "clip-1"
  imagePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5N2GQAAAAASUVORK5CYII="
} | ConvertTo-Json -Depth 5 -Compress

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5600/v1/jobs" `
  -ContentType "application/json" `
  -Body $payload
```

Note: `curl.exe --data-binary @-` is bash syntax. In PowerShell it can fail with parse errors such as `Jeton non reconnu`.

Integration tests (optional):

```powershell
$env:EVB_RUN_MUSETALK_TESTS="1"; yarn workspace @evb/local-avatar-engine test
```

If readiness is not green in the UI, use the suggestedFix commands from the panel.
