# AGENTS.md — E-Learning Video Builder (EVB)

## Repo quick map (high signal)
- Monorepo: **Yarn workspaces**.
- Workspaces (seen via `yarn workspaces list --verbose`):
  - `apps/local` (Next.js UI at http://localhost:3000)
  - `apps/local-avatar-engine` (Node HTTP server at http://localhost:5600)
  - `apps/cloud` (cloud worker/API used for demo/preview generation)
  - `packages/shared` (shared utilities)
- Core local dev commands (preferred):
  - UI: `yarn workspace @evb/local dev`
  - Local engine: `yarn workspace @evb/local-avatar-engine dev`
  - Engine diagnostics: `yarn workspace @evb/local-avatar-engine doctor`
  - Engine tests: `yarn workspace @evb/local-avatar-engine test`
- Source of truth for scripts: **root `package.json` + each workspace `package.json`** (do not guess—open them when needed).

---

## Authorities / constraints (non-negotiable)
- **MVP is locked: MuseTalk-first local avatar generator** (local-first; no vendor cost).
- **No scope creep**: do not propose new features; do not refactor broadly.
- **No surprise UI changes**: keep layout/IA stable; only small, targeted UX changes tied to the goal.
- **Efficiency**: minimize context, minimize files touched, minimize retries.
- **Windows/OneDrive**: avoid introducing build steps or tooling that spawns extra processes from repo root (EPERM risk).

---

## Default workflow (3 calls): Locate → Patch → Verify
### 1) LOCATE (fast, minimal)
- Identify the *single* integration point first.
- Use **PowerShell-native search** when `rg` isn’t installed:
  - `Select-String -Path "apps\local\src\**\*.ts","apps\local\src\**\*.tsx" -Pattern "<PATTERN>" -List`
- Prefer reading only the 1–3 most relevant files before changing anything.

### 2) PATCH (small diff discipline)
- Default: **touch 1–3 files max**.
- Prefer **local helpers** over new dependencies.
- Keep changes **reversible** and **testable**.
- Avoid wide renames, folder moves, “cleanup” refactors.

### 3) VERIFY (targeted)
- Always state what you ran (or why you didn’t).
- Preferred checks:
  - Engine: `yarn workspace @evb/local-avatar-engine test`
  - UI: `yarn workspace @evb/local dev` (confirm page loads; no red build errors)
- If UI tests are flaky/blocked by EPERM, do not add infra; keep changes minimal and rely on manual verification steps.

---

## MuseTalk/local-avatar-engine contract (do not drift)
- UI talks to local engine via `NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL` (default expected: `http://localhost:5600`).
- Engine endpoints (stable):
  - `GET /health/local-avatar` (doctor payload)
  - `POST /v1/jobs` (submit `{ jobId, clipId, avatarId, imagePngBase64, audioWavBase64, fps, bboxShift, preparationHint? }`)
  - `GET /v1/jobs/:jobId/:clipId/status`
  - `GET /v1/jobs/:jobId/:clipId/artifacts` (expects `{ mp4Base64, durationMs, cacheHit?, prepKey? }`)
- **Do not** store `mp4Base64` in persisted project storage. Only in-memory/object URL.

---

## Output discipline (required in every Codex response)
1) **What changed** (3–6 bullets)
2) **Files changed** (explicit list)
3) **Commands run** (or “not run” + reason)
4) **Manual test steps** (tight, numbered)

---

## Common failure patterns (handle surgically)
- Next.js build errors (syntax/typing): fix the exact line; do not refactor.
- Node-only imports in browser bundles (`node:*`): remove/guard; prefer Web APIs in `apps/local`.
- Cloud generation not configured: label as **cloud-only**; do not block **local** MuseTalk flows.

---

## When blocked (minimal escalation)
If a task requires repo knowledge not in context:
- Ask for the **single** missing fact (file path, script name, or console output line).
- Do not request broad uploads or full repo scans.
