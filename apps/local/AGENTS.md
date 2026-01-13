# Recommended nested file 2: apps/local/AGENTS.md
- Scope: Next.js UI only.
- Command: `yarn workspace @evb/local dev`
- Hard rule: no broad UI redesign; keep pages stable.
- Avoid Node-only imports in client bundles; prefer WebCrypto/Web APIs.
- Local avatar base URL: `NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL` (default http://localhost:5600).
- Default change size: 1–3 files; add minimal unit tests only if already used nearby.
- Output: summary + files + how to click-path verify in browser.
