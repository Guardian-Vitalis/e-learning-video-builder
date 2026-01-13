import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { promises as fs, existsSync } from "node:fs";
import { spawn } from "node:child_process";

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function shortHash(buffer) {
  return sha256Hex(buffer).slice(0, 8);
}

function yamlValue(value) {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(String(value));
}

function buildRealtimeConfig({
  version,
  avatarKey,
  preparation,
  videoPath,
  bboxShift,
  audioPath,
  fps,
  outputPath,
  modelsDir,
  preparedDir
}) {
  return [
    `musetalk_version: ${yamlValue(version)}`,
    `models_dir: ${yamlValue(modelsDir)}`,
    `work_dir: ${yamlValue(preparedDir)}`,
    `fps: ${yamlValue(fps)}`,
    `avatars:`,
    `  ${avatarKey}:`,
    `    preparation: ${yamlValue(preparation)}`,
    `    video_path: ${yamlValue(videoPath)}`,
    `    bbox_shift: ${yamlValue(bboxShift)}`,
    `audio_clips:`,
    `  clip0: ${yamlValue(audioPath)}`,
    `output_path: ${yamlValue(outputPath)}`
  ].join("\n");
}

async function runCommand(cmd, args, env, timeoutMs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, windowsHide: true, cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("musetalk timed out"));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `musetalk exited with code ${code}`));
    });
  });
}

export function buildAvatarKey({ avatarId, imageBuffer }) {
  const prefix = avatarId && avatarId.trim().length > 0 ? avatarId.trim() : "default";
  return `${prefix}-${shortHash(imageBuffer)}`;
}

function resolveScriptPath(repoDir) {
  const candidates = [
    path.join(repoDir, "realtime_inference.py"),
    path.join(repoDir, "scripts", "realtime_inference.py"),
    path.join(repoDir, "musetalk", "realtime_inference.py")
  ];
  return candidates.find((candidate) => {
    try {
      return existsSync(candidate);
    } catch {
      return false;
    }
  });
}

async function findOutputMp4(outputPath, workDir) {
  try {
    const stat = await fs.stat(outputPath);
    if (stat.size > 0) {
      return outputPath;
    }
  } catch {
    // ignore
  }
  const entries = await fs.readdir(workDir);
  const mp4s = entries.filter((entry) => entry.toLowerCase().endsWith(".mp4"));
  if (mp4s.length === 0) {
    return null;
  }
  const candidate = path.join(workDir, mp4s[0]);
  return candidate;
}

function resolveAvatarDir(repoDir, version, avatarKey) {
  const versionDir = version === "v15" ? "v15" : null;
  const base = versionDir
    ? path.join(repoDir, "results", versionDir)
    : path.join(repoDir, "results");
  return path.join(base, "avatars", avatarKey);
}

function resolveOutputMp4(repoDir, version, avatarKey) {
  const avatarDir = resolveAvatarDir(repoDir, version, avatarKey);
  return path.join(avatarDir, "vid_output", "clip0.mp4");
}

function resolveModelPaths(modelsDir, version) {
  if (version === "v15") {
    return {
      unetModel: path.join(modelsDir, "musetalkV15", "unet.pth"),
      unetConfig: path.join(modelsDir, "musetalkV15", "musetalk.json")
    };
  }
  return {
    unetModel: path.join(modelsDir, "musetalk", "pytorch_model.bin"),
    unetConfig: path.join(modelsDir, "musetalk", "musetalk.json")
  };
}

export function buildMuseTalkArgs({ configPath, version, modelsDir, ffmpegPath, fps }) {
  const modelPaths = resolveModelPaths(modelsDir, version);
  const whisperDir = path.join(modelsDir, "whisper");
  const fpsValue = Number.isFinite(fps) ? fps : 25;
  const args = [
    "-m",
    "scripts.realtime_inference",
    "--inference_config",
    configPath,
    "--version",
    version,
    "--unet_model_path",
    modelPaths.unetModel,
    "--unet_config",
    modelPaths.unetConfig,
    "--whisper_dir",
    whisperDir,
    "--fps",
    String(fpsValue)
  ];
  if (ffmpegPath) {
    args.push("--ffmpeg_path", ffmpegPath);
  }
  return args;
}

async function readHashFile(hashFile) {
  try {
    const raw = await fs.readFile(hashFile, "utf8");
    return raw.trim();
  } catch {
    return null;
  }
}

async function existsDir(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function runMuseTalkClip(input) {
  const {
    repoDir,
    pythonBin,
    modelsDir,
    ffmpegPath,
    version,
    avatarId,
    imagePngBase64,
    audioWavBase64,
    fps,
    bboxShift,
    preparationHint,
    preparedDir,
    outputPathAbs,
    timeoutMs,
    workRoot,
    runCommand: runCommandOverride
  } = input;

  if (!audioWavBase64) {
    throw new Error("audio_wav_missing");
  }
  if (!repoDir) {
    throw new Error("musetalk_repo_missing");
  }
  if (!modelsDir) {
    throw new Error("musetalk_models_missing");
  }
  const scriptPath = resolveScriptPath(repoDir);
  if (!scriptPath) {
    throw new Error("realtime_inference_not_found");
  }

  const tempBase = workRoot ?? path.join(os.tmpdir(), "evb-musetalk-");
  const workDir = await fs.mkdtemp(tempBase);
  const avatarPath = path.join(workDir, "avatar.png");
  const audioPath = path.join(workDir, "audio.wav");
  const configPath = path.join(workDir, "config.yaml");
  const outputPath = outputPathAbs ?? path.join(workDir, "output.mp4");

  const imageBuffer = Buffer.from(imagePngBase64, "base64");
  await fs.writeFile(avatarPath, imageBuffer);
  await fs.writeFile(audioPath, Buffer.from(audioWavBase64, "base64"));

  const avatarKey = buildAvatarKey({ avatarId, imageBuffer });
  const avatarDir = resolveAvatarDir(repoDir, version, avatarKey);
  const hashFile = path.join(avatarDir, "avatar_hash.txt");
  const desiredHash = sha256Hex(imageBuffer);
  const existingHash = await readHashFile(hashFile);
  const avatarDirExists = await existsDir(avatarDir);
  let preparation = false;
  if (preparationHint === "force") {
    preparation = true;
  } else if (avatarDirExists && existingHash && existingHash === desiredHash) {
    preparation = false;
  } else {
    preparation = true;
  }
  if (preparation) {
    await fs.rm(avatarDir, { recursive: true, force: true });
  }

  const config = buildRealtimeConfig({
    version,
    avatarKey,
    preparation,
    videoPath: avatarPath,
    bboxShift,
    audioPath,
    fps,
    outputPath,
    modelsDir,
    preparedDir: preparedDir ?? avatarDir
  });
  await fs.writeFile(configPath, config, "utf8");

  const env = { ...process.env };
  if (ffmpegPath) {
    env.PATH = `${ffmpegPath}${path.delimiter}${env.PATH || ""}`;
  }

  const args = buildMuseTalkArgs({
    configPath,
    version,
    modelsDir,
    ffmpegPath,
    fps
  });
  const runner = runCommandOverride ?? runCommand;
  await runner(pythonBin, args, env, timeoutMs, repoDir);
  const expectedMp4 = resolveOutputMp4(repoDir, version, avatarKey);
  const finalMp4 = await findOutputMp4(expectedMp4, workDir);
  if (!finalMp4) {
    throw new Error("musetalk_output_missing");
  }

  const mp4Buffer = await fs.readFile(finalMp4);
  if (preparation) {
    await fs.mkdir(avatarDir, { recursive: true });
    await fs.writeFile(hashFile, desiredHash, "utf8");
  }
  return {
    mp4Buffer,
    preparedDir: avatarDir,
    avatarKey,
    workDir
  };
}
