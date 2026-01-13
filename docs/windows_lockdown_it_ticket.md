Windows EPERM blocks child process execution (dev tooling blocked)

Summary
Windows is blocking child process execution with EPERM. This prevents Node tooling from spawning cmd/powershell/yarn/esbuild.

Impact
Local tests and builds are blocked because Node cannot spawn required child processes. Vitest cannot start.

Evidence
- Report path: C:\Users\Canad\AppData\Local\Temp\evb_windows_lockdown_report_2026-01-13T20-22-23-719Z.txt
- EPERM snippet:
  - cmd (abs): status=null errorCode=EPERM error=spawnSync C:\WINDOWS\system32\cmd.exe EPERM
  - powershell (abs): status=null errorCode=EPERM error=spawnSync C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe EPERM
  - node child: status=null errorCode=EPERM error=spawnSync C:\Program Files\nodejs\node.exe EPERM
  - yarn (name): status=null errorCode=EPERM error=spawnSync yarn EPERM

Reproduction (copy/paste)
C:\WINDOWS\system32\cmd.exe /c echo cmd_ok
C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "Write-Output ps_ok"
C:\Program Files\nodejs\node.exe -e "console.log('child_node_ok')"
C:\Program Files\nodejs\node.exe -e "require('child_process').spawnSync(process.env.ComSpec||'cmd',['/c','echo','spawn_ok'],{stdio:'inherit'});"

Minimum-viable allowlist request
- node.exe: C:\Program Files\nodejs\node.exe
- cmd.exe: C:\WINDOWS\system32\cmd.exe
- powershell.exe: C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe
- yarn runtime path (dynamic): %TEMP%\xfs-*\yarn
  - The xfs-* segment changes per run. A wildcard or publisher-based allowlist is preferred.

Recommended remediation options (ranked)
1) WDAC/AppLocker/SRP: allow Node to create child processes (cmd/powershell) and allow yarn runtime.
2) Defender/EDR: exception for CreateProcess from node.exe to cmd/powershell/yarn/esbuild.
3) Provide an approved non-OneDrive developer workspace (long-term).

Validation steps after fix
1) yarn diagnose:windows (expect NO EPERM rows)
2) yarn test:all
