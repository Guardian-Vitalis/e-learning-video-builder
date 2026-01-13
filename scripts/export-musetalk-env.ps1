param(
  [string]$EnvName = "MuseTalk"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$docsDir  = Join-Path $repoRoot "docs"
New-Item -ItemType Directory -Force -Path $docsDir | Out-Null

$envPath = Join-Path $docsDir "musetalk.env.yml"
$reqPath = Join-Path $docsDir "musetalk.requirements.txt"

# 1) conda env snapshot (no-builds) + remove prefix line
$envExport = & conda env export -n $EnvName --no-builds
if ($LASTEXITCODE -ne 0) { throw "conda env export failed (env=$EnvName)" }

$envExport |
  Where-Object { $_ -notmatch "^prefix:\s" } |
  Set-Content -Path $envPath -Encoding utf8

# 2) pip freeze
$pipFreeze = & conda run -n $EnvName python -m pip freeze
if ($LASTEXITCODE -ne 0) { throw "pip freeze failed (env=$EnvName)" }

$pipFreeze | Set-Content -Path $reqPath -Encoding utf8

# 3) pip check gate
& conda run -n $EnvName python -m pip check
if ($LASTEXITCODE -ne 0) { throw "pip check failed (env=$EnvName)" }

Write-Host "OK: wrote $envPath"
Write-Host "OK: wrote $reqPath"
