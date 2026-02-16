$ErrorActionPreference = "Stop"

function Resolve-MuseTalkRepo {
  $candidates = @(
    (Join-Path $PSScriptRoot "..\vendor\MuseTalk"),
    (Join-Path $PSScriptRoot "..\..\MuseTalk"),
    (Join-Path $PSScriptRoot "..\..\..\MuseTalk")
  )
  foreach ($candidate in $candidates) {
    $full = (Resolve-Path -Path $candidate -ErrorAction SilentlyContinue)
    if ($full) { return $full.Path }
  }
  return $null
}

function Resolve-ModelsDir($repoDir) {
  if (-not $repoDir) { return $null }
  $candidates = @(
    (Join-Path $repoDir "models"),
    (Join-Path $repoDir "checkpoints"),
    (Join-Path $repoDir "weights")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  return $null
}

function Resolve-PythonCmd {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @{ Exe = "py"; Args = @("-3.11") }
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @{ Exe = $python.Source; Args = @() }
  }

  return $null
}

$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$engineRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$py = Resolve-PythonCmd
if (-not $py) {
  Write-Error "Python not found. Install Python 3.11 and re-run."
  exit 1
}

$venvRoot = Join-Path $engineRoot ".venv"
& $py.Exe @($py.Args) -m venv $venvRoot

$venvPy = Join-Path $venvRoot "Scripts\python.exe"
if (-not (Test-Path $venvPy)) {
  Write-Error "Virtual env python not found at $venvPy"
  exit 1
}

& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
& $venvPy -m pip install opencv-python

$museRepo  = Resolve-MuseTalkRepo
$modelsDir = Resolve-ModelsDir $museRepo

Write-Host ""
Write-Host "Add the following to apps/local-avatar-engine/.env.local:"
Write-Host "EVB_PYTHON_BIN=$venvPy"
Write-Host "EVB_MUSETALK_REPO_DIR=$museRepo"
Write-Host "EVB_MUSETALK_MODELS_DIR=$modelsDir"
Write-Host "EVB_MUSETALK_VERSION=v15"
