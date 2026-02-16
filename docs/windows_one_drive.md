Windows OneDrive / Defender Quick Fix

Symptoms
- `spawn EPERM` or `esbuild` spawn errors.
- Vitest fails to load config on Windows.

Quick fixes (try in order)
1) Move the repo out of OneDrive, Desktop, or Documents.
   Example: `C:\dev\evb`
   Why: OneDrive sync and file locking can block binaries.
2) Add a Defender exclusion for the repo folder.
   Check Controlled Folder Access if enabled.
   Allow your terminal and `node.exe` if prompted.
3) Reinstall dependencies:
   - `rmdir /s /q node_modules`
   - `yarn install`
4) Verify esbuild binary exists:
   - `dir node_modules\esbuild\esbuild.exe`
   Check Defender quarantine history if it is missing.

Run tests
- `yarn workspace @evb/local test:unit`

Override (not recommended)
- `$env:EVB_ALLOW_ONEDRIVE="1"`
- `yarn test:all`

Path hints (risky locations)
- Paths containing `\OneDrive\`, `\Desktop\`, or `\Documents\`
