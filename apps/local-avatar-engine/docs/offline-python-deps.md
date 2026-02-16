# Offline Python Deps (Wheelhouse)

Use this when internet access is blocked and you need a local wheelhouse.

Build a wheelhouse on a machine with internet:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip download -d C:\path\to\wheelhouse -r C:\path\to\MuseTalk\requirements.txt
pip download -d C:\path\to\wheelhouse openmim==0.3.9 mmengine mmcv==2.0.1 mmdet==3.1.0 mmpose==1.1.0
pip download -d C:\path\to\wheelhouse chumpy==0.70
```

Use the wheelhouse on this machine:

```powershell
$env:EVB_OFFLINE="1"
$env:EVB_WHEELHOUSE="C:\path\to\wheelhouse"
yarn workspace @evb/local-avatar-engine install:musetalk-deps
```

Notes:
- `chumpy` may only be available as an sdist; ensure it is present in the wheelhouse.
