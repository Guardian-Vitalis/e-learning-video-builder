$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = (Resolve-Path (Join-Path -Path $scriptDir -ChildPath "..\\..\\..")).Path
$appRoot = Join-Path -Path $repoRoot -ChildPath "apps\\local-avatar-engine"

function Invoke-Pip {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CmdArgs)
  if (-not $CmdArgs -or $CmdArgs.Count -eq 0) {
    throw "Invoke-Pip called with no arguments"
  }
  & $pythonBin -m pip @CmdArgs
  if ($LASTEXITCODE -ne 0) {
    throw "pip failed: $($CmdArgs -join ' ')"
  }
}

function Invoke-Mim {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CmdArgs)
  if (-not $CmdArgs -or $CmdArgs.Count -eq 0) {
    throw "Invoke-Mim called with no arguments"
  }
  & $pythonBin -m mim @CmdArgs
  if ($LASTEXITCODE -ne 0) {
    throw "mim failed: $($CmdArgs -join ' ')"
  }
}

function Mask-Value {
  param([string]$Value)
  if (-not $Value) { return $null }
  return ($Value -replace "://[^/@]+@", "://***:***@")
}

function Load-EnvFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $false }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line.Split("=", 2)
    if ($parts.Length -ne 2) { return }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($key) { Set-Item -Path ("Env:{0}" -f $key) -Value $value }
  }
  return $true
}

$loaded = @()
if (Load-EnvFile (Join-Path -Path $repoRoot -ChildPath ".env")) { $loaded += ".env" }
if (Load-EnvFile (Join-Path -Path $repoRoot -ChildPath ".env.local")) { $loaded += ".env.local" }
if (Load-EnvFile (Join-Path -Path $appRoot -ChildPath ".env")) { $loaded += "apps/local-avatar-engine/.env" }
if (Load-EnvFile (Join-Path -Path $appRoot -ChildPath ".env.local")) { $loaded += "apps/local-avatar-engine/.env.local" }

Write-Host "Loaded env files: $($loaded -join ', ')"

$pythonBin = $env:EVB_PYTHON_BIN
if (-not $pythonBin) {
  $venvPy = Join-Path -Path $appRoot -ChildPath ".venv\\Scripts\\python.exe"
  if (Test-Path $venvPy) {
    $pythonBin = $venvPy
  } else {
    $pythonBin = "python"
  }
}

$musetalkRepoDir = $env:EVB_MUSETALK_REPO_DIR
if (-not $musetalkRepoDir) {
  $repoCandidate = Join-Path -Path $repoRoot -ChildPath "MuseTalk"
  $vendorCandidate = Join-Path -Path $repoRoot -ChildPath "vendor\\MuseTalk"
  if (Test-Path $repoCandidate) {
    $musetalkRepoDir = $repoCandidate
  } elseif (Test-Path $vendorCandidate) {
    $musetalkRepoDir = $vendorCandidate
  }
}

if (-not $musetalkRepoDir -or -not (Test-Path $musetalkRepoDir)) {
  Write-Error "Missing MuseTalk repo dir. Set EVB_MUSETALK_REPO_DIR in .env.local."
  exit 1
}

$requirements = Join-Path -Path $musetalkRepoDir -ChildPath "requirements.txt"
if (-not (Test-Path $requirements)) {
  Write-Error "Missing requirements.txt at $requirements"
  exit 1
}

$constraints = Join-Path -Path $appRoot -ChildPath "scripts\\musetalk-constraints.txt"
if (-not (Test-Path $constraints)) {
  Write-Error "Missing constraints file at $constraints"
  exit 1
}

Write-Host "Using python: $pythonBin"
$pythonVersion = (& $pythonBin -c "import sys; print(sys.version)").Trim()
$pythonVersionInfoRaw = (& $pythonBin -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')").Trim()
if (-not $pythonVersionInfoRaw) {
  throw "Could not determine Python version from $pythonBin"
}
$pythonVersionParts = $pythonVersionInfoRaw.Split(".")
if ($pythonVersionParts.Length -lt 2) {
  throw "Could not parse Python version '$pythonVersionInfoRaw' from $pythonBin"
}
$pythonMajor = [int]$pythonVersionParts[0]
$pythonMinor = [int]$pythonVersionParts[1]
if (($pythonMajor -gt 3) -or (($pythonMajor -eq 3) -and ($pythonMinor -ge 12))) {
  throw "MuseTalk deps require Python 3.10.x. Set EVB_PYTHON_BIN to your MuseTalk env python.exe (e.g. ...\envs\MuseTalk\python.exe) or activate that env before running yarn."
}
Write-Host "Python version: $pythonVersion"
Write-Host "Python version info: $pythonVersionInfoRaw"
Write-Host "Using MuseTalk repo: $musetalkRepoDir"

$pipVersion = (& $pythonBin -m pip --version).Trim()
Write-Host "pip version: $pipVersion"
& $pythonBin -m pip config debug -v

if ($env:HTTP_PROXY) { Write-Host "HTTP_PROXY: $(Mask-Value $env:HTTP_PROXY)" }
if ($env:HTTPS_PROXY) { Write-Host "HTTPS_PROXY: $(Mask-Value $env:HTTPS_PROXY)" }
if ($env:NO_PROXY) { Write-Host "NO_PROXY: $env:NO_PROXY" }
if ($env:EVB_PIP_PROXY) { Write-Host "EVB_PIP_PROXY: $(Mask-Value $env:EVB_PIP_PROXY)" }
if ($env:EVB_PIP_INDEX_URL) { Write-Host "EVB_PIP_INDEX_URL: $env:EVB_PIP_INDEX_URL" }
if ($env:EVB_PIP_EXTRA_INDEX_URL) { Write-Host "EVB_PIP_EXTRA_INDEX_URL: $env:EVB_PIP_EXTRA_INDEX_URL" }
if ($env:EVB_PIP_TRUSTED_HOST) { Write-Host "EVB_PIP_TRUSTED_HOST: $env:EVB_PIP_TRUSTED_HOST" }
if ($env:EVB_PIP_CERT) { Write-Host "EVB_PIP_CERT: $env:EVB_PIP_CERT" }
if ($env:EVB_WHEELHOUSE) { Write-Host "EVB_WHEELHOUSE: $env:EVB_WHEELHOUSE" }
if ($env:EVB_OFFLINE) { Write-Host "EVB_OFFLINE: $env:EVB_OFFLINE" }
if ($env:EVB_SKIP_CHUMPY) { Write-Host "EVB_SKIP_CHUMPY: $env:EVB_SKIP_CHUMPY" }

function Test-HostPort {
  param([string]$HostName, [int]$Port)
  try {
    $result = Test-NetConnection -ComputerName $HostName -Port $Port -WarningAction SilentlyContinue
    return [bool]$result.TcpTestSucceeded
  } catch {
    return $false
  }
}

$pypiOk = Test-HostPort -HostName "pypi.org" -Port 443
$githubOk = Test-HostPort -HostName "github.com" -Port 443
Write-Host "Connectivity pypi.org:443: $pypiOk"
Write-Host "Connectivity github.com:443: $githubOk"

$pipNoIndex = $false
if ($env:PIP_NO_INDEX -and $env:PIP_NO_INDEX -ne "0") { $pipNoIndex = $true }
$offlineMode = ($env:EVB_OFFLINE -eq "1") -or ($env:EVB_WHEELHOUSE) -or ($pipNoIndex -and -not $env:EVB_PIP_INDEX_URL) -or (-not $pypiOk) -or (-not $githubOk)
if ($env:EVB_FORCE_ONLINE -eq "1") { $offlineMode = $false }
Write-Host "Offline mode: $offlineMode"

function Get-Pip-Install-Args {
  param([string[]]$PackageArgs)
  if (-not $PackageArgs -or $PackageArgs.Count -eq 0) {
    throw "Get-Pip-Install-Args called with no arguments"
  }
  $args = @("install", "--no-build-isolation")
  if ($env:EVB_PIP_PROXY) { $args += @("--proxy", $env:EVB_PIP_PROXY) }
  if ($env:EVB_PIP_CERT) { $args += @("--cert", $env:EVB_PIP_CERT) }
  if ($offlineMode) {
    if (-not $env:EVB_WHEELHOUSE) {
      throw "Offline mode requires EVB_WHEELHOUSE. See apps/local-avatar-engine/docs/offline-python-deps.md"
    }
    $args += @("--no-index", "--find-links", $env:EVB_WHEELHOUSE)
  } else {
    if ($env:EVB_PIP_INDEX_URL) { $args += @("--index-url", $env:EVB_PIP_INDEX_URL) }
    if ($env:EVB_PIP_EXTRA_INDEX_URL) { $args += @("--extra-index-url", $env:EVB_PIP_EXTRA_INDEX_URL) }
    if ($env:EVB_PIP_TRUSTED_HOST) { $args += @("--trusted-host", $env:EVB_PIP_TRUSTED_HOST) }
  }
  $args += $PackageArgs
  return ,$args
}

function Invoke-Pip-Install {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PackageArgs)
  $args = Get-Pip-Install-Args $PackageArgs
  $previousNoIndex = $env:PIP_NO_INDEX
  if (-not $offlineMode) { $env:PIP_NO_INDEX = $null }
  try {
    Invoke-Pip @args
  } finally {
    $env:PIP_NO_INDEX = $previousNoIndex
  }
}

function Ensure-Musetalk-Repo-Path {
  $actionableError = "No writable site-packages found. Set EVB_PYTHON_BIN to a writable venv/conda env OR run the install script in an elevated terminal OR disable Controlled Folder Access for python.exe."
  $sitePkgsPath = (& $pythonBin -c "import site; print(site.getsitepackages()[0])").Trim()
  $userSitePkgsPath = (& $pythonBin -c "import site; print(site.getusersitepackages())").Trim()
  if (-not $sitePkgsPath) {
    throw "Could not resolve site-packages path."
  }

  $globalPthPath = Join-Path -Path $sitePkgsPath -ChildPath "musetalk_repo.pth"
  try {
    Set-Content -Path $globalPthPath -Value $musetalkRepoDir -Encoding ASCII
    Write-Host "musetalk_repo.pth target: global ($globalPthPath)"
    return
  } catch {
    $isAccessDenied = ($_.Exception -is [System.UnauthorizedAccessException]) -or ($_.Exception.Message -match "access.*denied|refus")
    if (-not $isAccessDenied) { throw }
    Write-Host "Global site-packages not writable ($sitePkgsPath). Falling back to user site-packages."
  }

  if (-not $userSitePkgsPath) {
    throw $actionableError
  }

  $userPthPath = Join-Path -Path $userSitePkgsPath -ChildPath "musetalk_repo.pth"
  try {
    if (-not (Test-Path $userSitePkgsPath)) {
      New-Item -Path $userSitePkgsPath -ItemType Directory -Force | Out-Null
    }
    Set-Content -Path $userPthPath -Value $musetalkRepoDir -Encoding ASCII
    Write-Host "musetalk_repo.pth target: user ($userPthPath)"
    return
  } catch {
    throw $actionableError
  }
}

function Test-Python-Import {
  param([string]$Name, [string]$ImportCmd)
  $cmd = "`"$pythonBin`" -c `"$ImportCmd`""
  $output = & cmd /c "$cmd 2>&1"
  if ($output) { Write-Host $output }
  if ($LASTEXITCODE -ne 0) { return $Name }
  return $null
}

$verifyOnly = $false
if ($offlineMode -and -not $env:EVB_WHEELHOUSE) {
  Write-Host "Offline mode detected (PIP_NO_INDEX=1 or no connectivity). No wheelhouse configured. Switching to VERIFY-ONLY."
  Write-Host "Set EVB_WHEELHOUSE=<path> or set EVB_PIP_INDEX_URL / EVB_PIP_PROXY to enable installs."
  $verifyOnly = $true
}

if ($verifyOnly) {
  Ensure-Musetalk-Repo-Path
  $missing = @()
  $missing += (Test-Python-Import -Name "torch" -ImportCmd "import torch; print('torch ok')")
  $missing += (Test-Python-Import -Name "numpy" -ImportCmd "import numpy; print('numpy ok')")
  $missing += (Test-Python-Import -Name "mmpose" -ImportCmd "import mmpose; print('mmpose ok')")
  $missing += (Test-Python-Import -Name "scripts.inference" -ImportCmd "import scripts.inference; print('scripts.inference ok')")
  if ($env:EVB_SKIP_CHUMPY -ne "1") {
    $missing += (Test-Python-Import -Name "chumpy" -ImportCmd "import chumpy; print('chumpy ok')")
  }
  $missing = $missing | Where-Object { $_ }
  if ($missing.Count -gt 0) {
    Write-Host "Missing imports: $($missing -join ', ')"
    Write-Host "Provide a wheelhouse (EVB_WHEELHOUSE) or set EVB_PIP_INDEX_URL / EVB_PIP_PROXY and re-run."
    exit 1
  }
  Write-Host "VERIFY-ONLY OK: all required imports present."
  exit 0
}

$pipArgs = @("-U", "pip", "wheel", "setuptools==60.2.0")
Invoke-Pip-Install @pipArgs
$pipArgs = @("-r", $requirements, "-c", $constraints)
Invoke-Pip-Install @pipArgs
$pipArgs = @("openmim==0.3.9")
Invoke-Pip-Install @pipArgs

Ensure-Musetalk-Repo-Path

$previousConstraint = $env:PIP_CONSTRAINT
$constraintsShort = (& cmd /c "for %I in (""$constraints"") do @echo %~sI").Trim()
$env:PIP_CONSTRAINT = if ($constraintsShort) { $constraintsShort } else { $constraints }

$mimArgs = @("install", "mmengine")
Invoke-Mim @mimArgs
$mimArgs = @("install", "mmcv==2.0.1")
Invoke-Mim @mimArgs
$mimArgs = @("install", "mmdet==3.1.0")
Invoke-Mim @mimArgs

# Workaround: chumpy setup.py imports pip internals and fails under PEP517 build isolation
# Install chumpy using legacy build (no isolated build env), then install mmpose normally.
$pipHelp = (& $pythonBin -m pip install --help 2>&1) | Out-String
$pipSupportsNoUsePep517 = $pipHelp -match "--no-use-pep517"
Write-Host "pip supports --no-use-pep517: $pipSupportsNoUsePep517"
if ($env:EVB_SKIP_CHUMPY -eq "1") {
  Write-Host "Skipping chumpy (EVB_SKIP_CHUMPY=1)"
} else {
  if ($offlineMode) {
    $pipArgs = Get-Pip-Install-Args @("chumpy==0.70")
    Write-Host "Chumpy pip args: $($pipArgs -join ' ')"
    try {
      Invoke-Pip @pipArgs
    } catch {
      throw "Offline mode requires chumpy artifacts in wheelhouse. See apps/local-avatar-engine/docs/offline-python-deps.md"
    }
  } else {
    $pipArgs = Get-Pip-Install-Args @("chumpy==0.70")
    if ($pipSupportsNoUsePep517) { $pipArgs += "--no-use-pep517" }
    Write-Host "Chumpy pip args: $($pipArgs -join ' ')"
    $previousNoIndex = $env:PIP_NO_INDEX
    $env:PIP_NO_INDEX = $null
    try {
      $chumpyCmd = "`"$pythonBin`" -m pip " + ($pipArgs -join " ")
      $chumpyOutputText = & cmd /c "$chumpyCmd 2>&1"
      $chumpyExitCode = $LASTEXITCODE
      if ($chumpyExitCode -ne 0) {
        Write-Host $chumpyOutputText
        $shouldFallback = $chumpyOutputText -match "ProxyError|No matching distribution found|from versions: none|TLS"
        if ($shouldFallback -and $githubOk) {
          $pipArgs = Get-Pip-Install-Args @("git+https://github.com/mattloper/chumpy.git")
          if ($pipSupportsNoUsePep517) { $pipArgs += "--no-use-pep517" }
          Write-Host "Chumpy fallback pip args: $($pipArgs -join ' ')"
          Invoke-Pip @pipArgs
        } else {
          Write-Host "Chumpy install failed. Set EVB_PIP_PROXY / EVB_PIP_INDEX_URL or use EVB_OFFLINE + EVB_WHEELHOUSE."
          throw "pip failed: $($pipArgs -join ' ')"
        }
      }
    } finally {
      $env:PIP_NO_INDEX = $previousNoIndex
    }
  }

  @'
import os
import site
import sys

marker = "EVB_PATCH: py311_getargspec_shim"
print("EVB_CHUMPY_MARKER:", marker)
candidates = [os.path.join(p, "chumpy", "ch.py") for p in site.getsitepackages()]
path = next((p for p in candidates if os.path.exists(p)), None)
if not path:
    print("chumpy ch.py not found", file=sys.stderr)
    sys.exit(1)

with open(path, "r", encoding="utf-8") as f:
    text = f.read()

if "getargspec" in text and marker not in text:
    lines = text.splitlines()
    new_lines = []
    injected = False
    for line in lines:
        new_lines.append(line)
        if (not injected) and line.startswith("import inspect"):
            new_lines.append("# " + marker)
            new_lines.append("from collections import namedtuple")
            new_lines.append("if not hasattr(inspect, \"getargspec\"):")
            new_lines.append("    ArgSpec = namedtuple(\"ArgSpec\", \"args varargs keywords defaults\")")
            new_lines.append("    def getargspec(func):")
            new_lines.append("        spec = inspect.getfullargspec(func)")
            new_lines.append("        return ArgSpec(spec.args, spec.varargs, spec.varkw, spec.defaults)")
            new_lines.append("    inspect.getargspec = getargspec")
            injected = True
    if not injected:
        print("import inspect not found in chumpy/ch.py", file=sys.stderr)
        sys.exit(1)
    text = "\n".join(new_lines)
    if text and not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print("Applied chumpy py311 shim")
else:
    print("Chumpy shim not needed")
'@ | & $pythonBin -
  if ($LASTEXITCODE -ne 0) { throw "Chumpy shim patch failed" }

  & $pythonBin -c "import chumpy; print('chumpy ok')"
  if ($LASTEXITCODE -ne 0) { throw "chumpy import failed" }
}

$pipArgs = @("mmpose==1.1.0")
Invoke-Pip-Install @pipArgs
$env:PIP_CONSTRAINT = $previousConstraint

$pipArgs = @("tqdm")
Invoke-Pip-Install @pipArgs

& $pythonBin -c "import mmpose; print('mmpose ok')"
if ($LASTEXITCODE -ne 0) { throw "mmpose import failed" }

& $pythonBin -c "import mmpose; import scripts.inference; print('OK: mmpose + scripts.inference')"
if ($LASTEXITCODE -ne 0) { throw "Final import verification failed" }

Write-Host "DONE: MuseTalk deps installed."
