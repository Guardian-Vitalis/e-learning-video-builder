import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { defaultPythonProbe } from "./pythonProbe.js";

const COMMON_WEIGHT_FILES = [
  "models/dwpose/dw-ll_ucoco_384.pth",
  "models/syncnet/latentsync_syncnet.pt",
  "models/face-parse-bisent/79999_iter.pth",
  "models/face-parse-bisent/resnet18-5c106cde.pth",
  "models/sd-vae/config.json",
  "models/sd-vae/diffusion_pytorch_model.bin",
  "models/whisper/config.json",
  "models/whisper/pytorch_model.bin",
  "models/whisper/preprocessor_config.json"
];

const WEIGHT_FILES_V15 = [
  "models/musetalkV15/musetalk.json",
  "models/musetalkV15/unet.pth"
];

const WEIGHT_FILES_V1 = [
  "models/musetalk/musetalk.json",
  "models/musetalk/pytorch_model.bin"
];

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runCommand(cmd, args, timeoutMs) {
  return withTimeout(
    new Promise((resolve) => {
      const child = spawn(cmd, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        const spawnBlocked = Boolean(err && err.code === "EPERM");
        const reason = spawnBlocked ? "spawn_blocked" : err.message;
        resolve({ ok: false, reason, spawnBlocked });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        resolve({ ok: code === 0, stdout, stderr });
      });
    }),
    timeoutMs
  );
}

export async function collectHealthDetails(options = {}) {
  const env = options.env ?? process.env;
  const repoDir = options.repoDir ?? env.EVB_MUSETALK_REPO_DIR;
  const version = options.version ?? env.EVB_MUSETALK_VERSION ?? "v15";
  const modelsDir =
    options.modelsDir ??
    env.EVB_MUSETALK_MODELS_DIR ??
    (repoDir ? path.join(repoDir, "models") : undefined);
  const ffmpegPath =
    options.ffmpegPath ??
    env.EVB_MUSETALK_FFMPEG_PATH ??
    env.EVB_FFMPEG_PATH;
  const pythonBin = options.pythonBin ?? env.EVB_MUSETALK_PYTHON ?? "python";
  const cache = options.cache;
  const exists = options.existsSync ?? existsSync;
  const runner = options.runCommand ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 1500;

  const musetalkRepo = (() => {
    if (!repoDir) {
      return { ok: false, reason: "EVB_MUSETALK_REPO_DIR not set" };
    }
    if (!exists(repoDir)) {
      return { ok: false, path: repoDir, reason: "Repo path not found" };
    }
    return { ok: true, path: repoDir };
  })();

  const models = (() => {
    const missing = [];
    const present = [];
    if (!modelsDir) {
      return {
        missing: [...COMMON_WEIGHT_FILES, ...(version === "v15" ? WEIGHT_FILES_V15 : WEIGHT_FILES_V1)],
        present
      };
    }
    const resolveModelPath = (relPath) => {
      if (relPath.startsWith("models/")) {
        return path.join(modelsDir, relPath.slice("models/".length));
      }
      return path.join(modelsDir, relPath);
    };
    const required = [
      ...COMMON_WEIGHT_FILES,
      ...(version === "v15" ? WEIGHT_FILES_V15 : WEIGHT_FILES_V1)
    ];
    const optional = version === "v15" ? WEIGHT_FILES_V1 : WEIGHT_FILES_V15;
    const expected = [...required, ...optional];
    for (const rel of expected) {
      const candidate = resolveModelPath(rel);
      if (exists(candidate)) {
        present.push(rel);
      } else if (required.includes(rel)) {
        missing.push(rel);
      }
    }
    return { missing, present };
  })();

  const ffmpeg = await (async () => {
    if (ffmpegPath) {
      if (exists(ffmpegPath)) {
        return { ok: true, path: ffmpegPath, spawnBlocked: false };
      }
      return {
        ok: false,
        path: ffmpegPath,
        reason: "EVB_FFMPEG_PATH not found",
        spawnBlocked: false
      };
    }
    const result = await runner("ffmpeg", ["-version"], timeoutMs);
    if (result.ok) {
      const version = String(result.stdout || result.stderr || "").split("\n")[0] || undefined;
      return { ok: true, path: "ffmpeg", version, spawnBlocked: false };
    }
    return {
      ok: false,
      reason: result.reason || "ffmpeg not available",
      spawnBlocked: Boolean(result.spawnBlocked)
    };
  })();

  const pythonProbe = options.pythonProbe ?? defaultPythonProbe;
  const python = pythonProbe(pythonBin, timeoutMs);

  const pythonModules = python.data ?? {};
  const mmlabFromPython = {
    mmengine: { ok: Boolean(pythonModules.mmengine), version: pythonModules.mmengine },
    mmcv: { ok: Boolean(pythonModules.mmcv), version: pythonModules.mmcv },
    mmdet: { ok: Boolean(pythonModules.mmdet), version: pythonModules.mmdet },
    mmpose: { ok: Boolean(pythonModules.mmpose), version: pythonModules.mmpose }
  };

  const cacheSummary = cache?.getSummary
    ? cache.getSummary({ includeKeys: process.env.EVB_LOCAL_AVATAR_CACHE_KEYS === "1" })
    : { preparedAvatars: 0 };

  const ok =
    Boolean(ffmpeg.ok) &&
    Boolean(python.ok) &&
    Boolean(musetalkRepo.ok) &&
    models.missing.length === 0;

  const actionItems = [];
  if (!repoDir) {
    actionItems.push("Set EVB_MUSETALK_REPO_DIR to the MuseTalk repo root.");
  } else if (!musetalkRepo.ok) {
    actionItems.push(`MuseTalk repo not found at ${repoDir}. Point EVB_MUSETALK_REPO_DIR to the repo root.`);
  }
  if (!python.ok) {
    actionItems.push(
      "Install or activate Python 3.10 via Miniconda and ensure torch/mmengine/mmcv/mmdet/mmpose import without errors."
    );
    if (python.version && !python.version.startsWith("3.10")) {
      actionItems.push(
        `MuseTalk requires Python 3.10 (you are using ${python.version}). Create/activate a conda musetalk env.`
      );
    }
  } else if (python.version && !python.version.startsWith("3.10")) {
    actionItems.push(
      `MuseTalk requires Python 3.10 (you are using ${python.version}). Create/activate a conda musetalk env.`
    );
  }
  if (python.spawnBlocked || ffmpeg.spawnBlocked) {
    actionItems.push("Disable Defender/AV blocked spawns for Python and FFmpeg (Controlled Folder Access).");
  }
  if (!ffmpeg.ok) {
    actionItems.push("Install FFmpeg and add it to PATH or set EVB_MUSETALK_FFMPEG_PATH.");
  }
  if (models.missing.length > 0) {
    actionItems.push("Run MuseTalk's download_weights script so the missing models are available.");
  }

  return {
    ok,
    mode: musetalkRepo.ok ? "musetalk" : "emulator",
    actionItems,
    resolved: {
      repoDir: repoDir ?? null,
      modelsDir: modelsDir ?? null,
      python: python.exe ?? pythonBin,
      ffmpegPath: ffmpegPath ?? null
    },
    musetalk: {
      repoDirExists: Boolean(musetalkRepo.ok),
      python: {
        ok: python.ok,
        version: python.version,
        spawnBlocked: Boolean(python.spawnBlocked),
        exe: python.exe ?? pythonBin,
        stderr: python.stderr ?? null,
        error: python.error ?? null
      },
      torch: {
        ok: python.ok && Boolean(pythonModules.torch),
        version: pythonModules.torch,
        cudaAvailable: Boolean(pythonModules.cuda)
      },
      mmlabImports: mmlabFromPython,
      ffmpeg: {
        ok: Boolean(ffmpeg.ok),
        path: ffmpeg.path,
        spawnBlocked: Boolean(ffmpeg.spawnBlocked)
      },
      models: {
        missing: models.missing,
        present: models.present
      }
    },
    cache: cacheSummary
  };
}
