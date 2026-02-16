import { spawnSync } from "node:child_process";
import { getEnvBootstrapState } from "../lib/envBootstrap";

type HealthResponse = {
  ok?: boolean;
};

type MuseTalkHealthResponse = {
  ok?: boolean;
  pythonBin?: string | null;
  pythonExists?: boolean | null;
  musetalkRepoDir?: string | null;
  musetalkRepoExists?: boolean;
  musetalkModelsDir?: string | null;
  musetalkModelsDirExists?: boolean;
  unetPath?: string | null;
  unetExists?: boolean;
  ffmpegPath?: string | null;
  ffmpegPathExists?: boolean;
  ffmpegOnPath?: boolean;
};

const DEFAULT_ENGINE_URL = "http://localhost:5600";
const CORE_IMPORTS = [
  "torch",
  "numpy",
  "cv2",
  "tqdm",
  "diffusers",
  "transformers",
  "accelerate",
  "einops",
  "omegaconf",
  "librosa",
  "soundfile",
  "moviepy",
  "imageio",
  "ffmpeg",
  "huggingface_hub",
  "requests",
  "mmengine",
  "mmcv",
  "mmdet",
  "mmpose",
  "musetalk",
  "scripts.inference"
];

function line(text: string) {
  console.log(text);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON from ${url}: ${message}`);
  }
}

function runPythonImportCheck(pythonBin: string, repoDir: string, importNames: string[]) {
  const script = [
    "import importlib, json, sys",
    `names = ${JSON.stringify(importNames)}`,
    "failures = []",
    "def try_import(name):",
    "    try:",
    "        importlib.import_module(name)",
    "    except Exception as e:",
    "        failures.append({'name': name, 'error': str(e)})",
    "for name in names:",
    "    try_import(name)",
    "ok = len(failures) == 0",
    "payload = {'ok': ok, 'failures': failures}",
    "print(json.dumps(payload))",
    "sys.exit(0 if ok else 2)"
  ].join("\n");

  const result = spawnSync(pythonBin, ["-c", script], {
    cwd: repoDir,
    encoding: "utf8",
    windowsHide: true
  });

  return result;
}

async function run() {
  const failures: string[] = [];
  const { repoRoot, loadedFiles } = getEnvBootstrapState();
  const debugEnv = process.env.EVB_DEBUG_ENV_BOOTSTRAP === "1";
  line(`repoRoot used: ${repoRoot}`);
  if (debugEnv) {
    line(`loaded env files: ${loadedFiles.join(", ") || "<none>"}`);
  }
  const provider = (process.env.AVATAR_PROVIDER ?? "").trim();

  line(`provider selected = ${provider || "<unset>"}`);
  if (provider !== "local_musetalk") {
    failures.push(
      "FIX: Set AVATAR_PROVIDER=local_musetalk in repo-root .env.local (and restart yarn dev)"
    );
  }

  const engineUrl =
    (process.env.NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL ?? "").trim() || DEFAULT_ENGINE_URL;

  let healthOk = false;
  try {
    const health = await fetchJson<HealthResponse>(`${engineUrl}/health`);
    healthOk = health?.ok === true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(
      `FIX: Ensure local-avatar-engine is running and reachable at ${engineUrl} (${message})`
    );
    failures.push(
      "FIX: If port 5600 is already in use, run: netstat -ano | findstr :5600 then taskkill /PID 1234 /F (replace 1234 with the PID shown)"
    );
  }

  if (healthOk) {
    line(`local avatar engine reachable at ${engineUrl}`);
  } else if (!failures.some((entry) => entry.includes("local-avatar-engine"))) {
    failures.push(
      `FIX: Ensure local-avatar-engine is running and responds on ${engineUrl}/health`
    );
    failures.push(
      "FIX: If port 5600 is already in use, run: netstat -ano | findstr :5600 then taskkill /PID 1234 /F (replace 1234 with the PID shown)"
    );
  }

  let musetalkHealth: MuseTalkHealthResponse | null = null;
  try {
    musetalkHealth = await fetchJson<MuseTalkHealthResponse>(`${engineUrl}/health/musetalk`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(
      `FIX: Ensure ${engineUrl}/health/musetalk responds with MuseTalk checks (${message})`
    );
  }

  if (musetalkHealth) {
    const repoOk = musetalkHealth.musetalkRepoExists === true;
    const modelsOk = musetalkHealth.musetalkModelsDirExists === true;
    const unetOk = musetalkHealth.unetExists === true;
    const ffmpegOk =
      musetalkHealth.ffmpegPathExists === true || musetalkHealth.ffmpegOnPath === true;
    const pythonOk =
      typeof musetalkHealth.pythonBin === "string" && musetalkHealth.pythonBin.length > 0;

    line(`musetalk repo dir valid = ${repoOk}`);
    line(`musetalk models dir valid = ${modelsOk}`);
    line(`unetExists: ${unetOk}`);
    line(`ffmpeg available: ${ffmpegOk}`);
    line(`python bin resolved: ${pythonOk ? musetalkHealth.pythonBin : "<unset>"}`);

    if (!pythonOk) {
      failures.push("FIX: Set EVB_PYTHON_BIN in local-avatar-engine .env.local");
    }
    if (!repoOk) {
      failures.push("FIX: Set EVB_MUSETALK_REPO_DIR to your MuseTalk repo path");
    }
    if (!modelsOk) {
      failures.push("FIX: Set EVB_MUSETALK_MODELS_DIR to the MuseTalk models directory");
    }
    if (!unetOk) {
      const unetPath = musetalkHealth.unetPath ?? "models/musetalkV15/unet.pth";
      failures.push(
        `FIX: Missing ${unetPath}. Ensure EVB_MUSETALK_MODELS_DIR contains musetalkV15/unet.pth`
      );
    }
    if (!ffmpegOk) {
      failures.push("FIX: Install ffmpeg or set EVB_FFMPEG_PATH to the ffmpeg binary");
    }
  }

  const pythonBin =
    (process.env.EVB_PYTHON_BIN ?? "").trim() ||
    (musetalkHealth?.pythonBin ?? "").trim() ||
    "python";
  const musetalkRepoDir =
    (process.env.EVB_MUSETALK_REPO_DIR ?? "").trim() ||
    (musetalkHealth?.musetalkRepoDir ?? "").trim();

  if (musetalkRepoDir) {
    const result = runPythonImportCheck(pythonBin, musetalkRepoDir, CORE_IMPORTS);
    const stdout = String(result.stdout ?? "").trim();
    const stderr = String(result.stderr ?? "").trim();
    let parsed: { ok?: boolean; failures?: { name: string; error: string }[] } | null = null;
    if (stdout) {
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
    }

    if (!parsed || parsed.ok !== true || result.status !== 0) {
      line("python imports: FAIL");
      const failureItems = parsed?.failures ?? [];
      if (failureItems.length > 0) {
        const missingNames = failureItems.map((item) => item.name).join(", ");
        line(`missing imports: ${missingNames}`);
        const lastError = failureItems[failureItems.length - 1]?.error ?? "";
        if (lastError) {
          const lastLine = lastError.split(/\r?\n/).pop() ?? lastError;
          line(`last error: ${lastLine}`);
        }
      } else if (stderr) {
        line(`python error: ${stderr.split(/\r?\n/).pop() ?? stderr}`);
      } else if (stdout) {
        line(`python output: ${stdout}`);
      }

      failures.push(
        "FIX: Run yarn workspace @evb/local-avatar-engine install:musetalk-deps"
      );
      failures.push(
        "FIX: Or run powershell -ExecutionPolicy Bypass -File apps/local-avatar-engine/scripts/install-musetalk-deps.ps1"
      );
      failures.push(
        "FIX: Use a Python 3.10 env for EVB_PYTHON_BIN (MuseTalk recommended), or install missing deps into your EVB_PYTHON_BIN venv."
      );
    } else {
      line("python imports: PASS");
    }
  }

  if (failures.length > 0) {
    for (const fix of failures) {
      console.error(fix);
    }
    process.exitCode = 1;
    return;
  }

  line("PASS");
  process.exitCode = 0;
}

run().catch((err) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
