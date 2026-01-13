# MuseTalk local worker (Windows)

This doc covers the Windows MuseTalk local worker and the environment snapshot workflow.

## Export the conda environment snapshot

Run from repo root:

```powershell
.\scripts\export-musetalk-env.ps1
```

Optional: specify a different conda env name (defaults to "MuseTalk"):

```powershell
.\scripts\export-musetalk-env.ps1 -EnvName MuseTalk
```

### Files generated
- `docs/musetalk.env.yml` (from `conda env export --no-builds`, with the `prefix:` line removed)
- `docs/musetalk.requirements.txt` (from `pip freeze`)

The script also runs `pip check` and exits non-zero on any failure.

## Verify the local avatar engine health

Start the engine:

```powershell
yarn workspace @evb/local-avatar-engine dev
```

Check basic health:

```powershell
curl http://localhost:5600/health
```

Run the deep MuseTalk self-test:

```powershell
curl http://localhost:5600/health/local-avatar
```

Expected success response includes `ok: true` and a `versions` map for:
`torch`, `diffusers`, `transformers`, `huggingface_hub`, `mmcv`, `mmpose`, `mmdet`.

If the self-test times out, set a higher timeout (milliseconds) before starting the engine:

```powershell
$env:EVB_LOCAL_AVATAR_SELFTEST_TIMEOUT_MS = 180000
```

If conda is not discoverable on PATH, set the full conda.exe path:

```powershell
$env:EVB_CONDA_EXE = "C:\\Users\\Canad\\miniconda3\\Scripts\\conda.exe"
```
