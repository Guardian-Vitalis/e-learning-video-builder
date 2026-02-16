# Recommended nested file 1: apps/local-avatar-engine/AGENTS.md
- Scope: local engine only (Node server + doctor).
- Commands: `yarn workspace @evb/local-avatar-engine dev|doctor|test`
- Contract: keep /health/local-avatar + /v1/jobs + /status + /artifacts stable.
- Windows-first: spawnSync must pass env safely; avoid shell-quoted commands.
- Default change size: 1–2 files; add tests only inside this workspace runner.
- Output: what changed + files + means to validate via doctor + test.
