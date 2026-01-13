MuseTalk Setup Checklist

Prereqs
- Install Conda (Miniconda recommended).
- Create a Python 3.10 environment.
  - `conda create -n musetalk python=3.10`
  - `conda activate musetalk`
- Ensure CUDA 11.7/11.8 is installed and matches your GPU driver.

Install dependencies
- Follow the MuseTalk repo instructions for requirements.
- Verify `python --version` shows 3.10.x in the environment.
- Ensure Torch 2.0.1 + CUDA is installed for your GPU.
- Example: `pip install torch==2.0.1+cu118 torchvision==0.15.2+cu118 -f https://download.pytorch.org/whl/torch_stable.html`
- Install MuseTalk python deps:
  - `pip install -r requirements.txt`
- Install MMLab dependencies via openmim:
  - `pip install -U openmim`
  - `mim install mmengine`
  - `mim install mmcv==2.0.1`
  - `mim install mmdet==3.1.0`
  - `mim install mmpose==1.1.0`
- **Don’t use system Python 3.13; MuseTalk requires the conda 3.10 env above.**

Download weights/assets
- Run the provided weight download scripts in the MuseTalk repo.
- Windows users: prefer the provided `.bat` download script when available.
- Confirm the expected checkpoint files exist before running inference.
- Required weights: use the upstream `download_weights` script as the source of truth.

FFmpeg (Windows)
- Install FFmpeg and add it to PATH.
- Verify with `ffmpeg -version` in a new terminal.
 - /health/details will report whether ffmpeg was found and the detected version.

Realtime inference prep
- MuseTalk supports a preparation step (e.g., `--preparation true|false`).
- Use `--preparation true` once to build caches.
- Recommended: `fps=25` for stable previews unless your pipeline requires otherwise.
- bboxShift: adjust to shift the face crop center if the framing is off.
- Local wrapper caching uses a prep key: avatar ID/image hash + fps + bboxShift.
- Changing fps or bboxShift forces a new preparation run.
- Prepared avatars are stored under `results/.../avatars/<avatar_id>` in the MuseTalk repo.

EVB Local Avatar Service mapping
- Avatar cache key: based on avatar ID/image hash + fps + bboxShift.
- FFmpeg path: uses EVB_MUSETALK_FFMPEG_PATH or system PATH resolution by default.
- Defaults: stub implementation unless EVB_LOCAL_AVATAR_IMPL=musetalk is set.

Local avatar engine env vars
- `EVB_LOCAL_AVATAR_IMPL=stub|musetalk` (default stub)
- `EVB_MUSETALK_REPO_DIR=<path to MuseTalk repo>`
- `EVB_MUSETALK_PYTHON=<python executable>` (default `python`)
- `EVB_MUSETALK_MODELS_DIR=<path to models>` (default `<repo>/models`)
- `EVB_MUSETALK_FFMPEG_PATH=<ffmpeg bin directory>` (optional)
- `EVB_MUSETALK_TIMEOUT_MS=<milliseconds>` (optional)

Health diagnostics
- GET `/health/details` returns ffmpeg detection and missing weight files.
- Use this when diagnosing missing binaries or weights.
- It also checks python, torch, and MMLab imports (mmengine/mmcv/mmdet/mmpose).
- The wrapper checks for required model files (do not download automatically):
  - `models/musetalkV15/musetalk.json`
  - `models/musetalkV15/unet.pth`
  - `models/musetalk/musetalk.json`
  - `models/musetalk/pytorch_model.bin`
  - `models/whisper/config.json`
  - `models/whisper/pytorch_model.bin`
  - `models/whisper/preprocessor_config.json`
  - `models/dwpose/dw-ll_ucoco_384.pth`
  - `models/syncnet/latentsync_syncnet.pt`
  - `models/face-parse-bisent/79999_iter.pth`
  - `models/face-parse-bisent/resnet18-5c106cde.pth`
  - `models/sd-vae/config.json`
  - `models/sd-vae/diffusion_pytorch_model.bin`

Validation
1) Activate env: `conda activate musetalk`
2) Verify FFmpeg: `ffmpeg -version`
3) Run a short MuseTalk demo or smoke test from the MuseTalk repo.
