Windows Testing Notes

Shared tests (non-watch by default):
`yarn test:shared`

Watch mode:
`yarn test:shared:watch`

Cloud tests:
`yarn workspace @evb/cloud test --run`

If you still see EPERM under OneDrive:
1) Move the repo outside OneDrive (example: `C:\dev\evb`), then rerun `yarn test:shared`.
2) Or set the Vite cache dir to temp and rerun:
   `set VITE_CACHE_DIR=%TEMP%\evb-vite-cache`
   `yarn test:shared`

The shared test config uses `pool: "threads"` with `singleThread: true` to reduce child process spawns on Windows.
