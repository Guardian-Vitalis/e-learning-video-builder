Windows Dev Notes

Recommended setup
1) Keep the repo outside OneDrive or other protected folders (example: `C:\dev\evb`).
2) Use a regular user shell first; only try an elevated shell if you still hit EPERM.
3) Enable long paths if you see path length errors.

Defender / antivirus
- Add an exclusion for the repo folder (example: `C:\dev\evb`).
- Check Controlled Folder Access. If enabled, allow your terminal and `node.exe`.
- Review quarantine history to ensure `node_modules\esbuild\esbuild.exe` was not removed.

If EPERM persists
1) Delete and reinstall dependencies:
   - `rmdir /s /q node_modules`
   - `yarn install`
2) Verify the esbuild binary exists:
   - `dir node_modules\esbuild\esbuild.exe`
3) If the binary exists but still fails, clear Yarn cache and reinstall:
   - `yarn cache clean`
   - `rmdir /s /q node_modules`
   - `yarn install`

Validate
- `yarn workspace @evb/local test:unit`

Run all tests
- `yarn workspace @evb/local test:unit`
- `yarn workspace @evb/cloud test`
- `yarn workspace @evb/local-avatar-engine test`
