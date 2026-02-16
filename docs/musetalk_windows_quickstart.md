MuseTalk Windows Quick Start

1. **Clone/prep (PowerShell/Miniconda prompt)**
   - Ensure PowerShell is running without OneDrive syncing; best practice: work under `C:\dev\E-Learning`.
   - Note: PowerShell has a `curl` alias. Use `curl.exe` (the binary) when hitting endpoints (`curl.exe http://localhost:5600/health/details`).
   - Clone the repo and MuseTalk if not done:
     ```powershell
     git clone https://github.com/evb/E-Learning.git C:\dev\E-Learning
     cd C:\dev\E-Learning
     git clone https://github.com/BIGVU/musetalk.git C:\dev\MuseTalk
     ```
2. **Create and activate the Python environment**
   ```powershell
   conda create -n musetalk python=3.10
   conda activate musetalk
   ```
   **Warning:** MuseTalk only works on Python 3.10. Do NOT use system Python 3.13.
3. **Install Torch + MuseTalk dependencies**
   ```powershell
   pip install torch==2.0.1+cu118 torchvision==0.15.2+cu118 -f https://download.pytorch.org/whl/torch_stable.html
   pip install -r C:\dev\MuseTalk\requirements.txt
   pip install -U openmim
   mim install mmengine
   mim install mmcv==2.0.1
   mim install mmdet==3.1.0
   mim install mmpose==1.1.0
   ```
4. **Install weights/assets**
   ```powershell
   cd C:\dev\MuseTalk
   ./scripts/download_weights.bat
   ```
   Ensure the following directories exist (Health details checks them):
   - `models/musetalkV15/`
   - `models/musetalk/`
   - `models/whisper/`
   - `models/dwpose/`
   - `models/syncnet/`
   - `models/face-parse-bisent/`
   - `models/sd-vae/`
5. **Install FFmpeg**
   - Download the Windows ZIP, unzip, and add the `bin` folder to `PATH`.
   - Alternatively set `EVB_MUSETALK_FFMPEG_PATH=C:\ffmpeg\bin`.
6. **Verify the environment**
   ```powershell
   conda --version
   python --version
   ffmpeg -version
   curl.exe http://localhost:5600/health/details
   yarn workspace @evb/local-avatar-engine doctor (run from the E-Learning repo root; not the MuseTalk folder)
   ```
7. **Warning**
   Always run MuseTalk commands from the MuseTalk repo root (`C:\dev\MuseTalk`). Running `python -m scripts.realtime_inference` outside that directory can fail due to relative imports.
8. **Recommended defaults**
   ```
   set EVB_LOCAL_AVATAR_IMPL=musetalk
   set EVB_MUSETALK_REPO_DIR=C:\dev\MuseTalk
   set EVB_MUSETALK_MODELS_DIR=C:\dev\MuseTalk\models
   set EVB_LOCAL_AVATAR_URL=http://localhost:5600
   yarn workspace @evb/local-avatar-engine doctor
   ```
