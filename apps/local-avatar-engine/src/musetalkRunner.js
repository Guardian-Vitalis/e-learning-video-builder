import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { promises as fs, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const MIN_PREVIEW_BYTES = 50 * 1024;
const FFPROBE_TIMEOUT_MS = 8000;
const MIN_DURATION_MS = 250;
const SNIFF_BYTES = 2048;
const TAIL_BYTES = 512;
const MIN_STABLE_BYTES = 200000;
const STABLE_WINDOW_MS = 1000;
const STABLE_TIMEOUT_MS = 60000;
const STABLE_POLL_MS = 300;

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

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
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

function tailText(text, maxLines, maxChars) {
  if (!text) return "";
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const sliced = lines.slice(Math.max(lines.length - maxLines, 0)).join("\n");
  if (sliced.length <= maxChars) return sliced;
  return sliced.slice(sliced.length - maxChars);
}

function formatCmd(cmd, args) {
  return [cmd, ...args].join(" ");
}

function formatFailure({ step, code, stderr, cmd, error }) {
  const exitPart = typeof code === "number" ? `exit=${code}` : "exit=unknown";
  const stderrTail = tailText(stderr, 40, 2400);
  const stderrPart = stderrTail ? ` stderr="${stderrTail.replace(/\s+/g, " ").trim()}"` : "";
  const errPart = error ? ` error="${String(error).replace(/\s+/g, " ").trim()}"` : "";
  return `musetalk_failed: step=${step} ${exitPart}${stderrPart}${errPart} cmd="${cmd}"`;
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

function hasMoovAtom(buffer) {
  return buffer.indexOf("moov") !== -1;
}

function readUint32BE(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  return buffer.readUInt32BE(offset);
}

function readUint64BE(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  const high = buffer.readUInt32BE(offset);
  const low = buffer.readUInt32BE(offset + 4);
  return (BigInt(high) << 32n) + BigInt(low);
}

function parseMvhdDurationMs(buffer) {
  const limit = buffer.length;
  let cursor = 0;
  while (cursor + 8 <= limit) {
    const size32 = readUint32BE(buffer, cursor);
    const type = buffer.toString("ascii", cursor + 4, cursor + 8);
    if (!size32) break;
    let size = size32;
    let headerSize = 8;
    if (size32 === 1) {
      const size64 = readUint64BE(buffer, cursor + 8);
      if (size64 === null) break;
      size = Number(size64);
      headerSize = 16;
    } else if (size32 === 0) {
      size = limit - cursor;
    }
    if (size < headerSize || cursor + size > limit) break;
    if (type === "moov") {
      const moovStart = cursor + headerSize;
      const moovEnd = cursor + size;
      let inner = moovStart;
      while (inner + 8 <= moovEnd) {
        const atomSize32 = readUint32BE(buffer, inner);
        const atomType = buffer.toString("ascii", inner + 4, inner + 8);
        if (!atomSize32) break;
        let atomSize = atomSize32;
        let atomHeader = 8;
        if (atomSize32 === 1) {
          const atomSize64 = readUint64BE(buffer, inner + 8);
          if (atomSize64 === null) break;
          atomSize = Number(atomSize64);
          atomHeader = 16;
        } else if (atomSize32 === 0) {
          atomSize = moovEnd - inner;
        }
        if (atomSize < atomHeader || inner + atomSize > moovEnd) break;
        if (atomType === "mvhd") {
          const payloadStart = inner + atomHeader;
          if (payloadStart + 20 > moovEnd) return null;
          const version = buffer[payloadStart];
          if (version === 1) {
            const timescale = readUint32BE(buffer, payloadStart + 20);
            const duration = readUint64BE(buffer, payloadStart + 24);
            if (!timescale || duration === null) return null;
            const durationMs = Number(duration * 1000n / BigInt(timescale));
            return Number.isFinite(durationMs) ? durationMs : null;
          }
          const timescale = readUint32BE(buffer, payloadStart + 12);
          const duration = readUint32BE(buffer, payloadStart + 16);
          if (!timescale || duration === null) return null;
          const durationMs = Math.round((duration / timescale) * 1000);
          return Number.isFinite(durationMs) ? durationMs : null;
        }
        inner += atomSize;
      }
    }
    cursor += size;
  }
  return null;
}

async function probeMp4DurationMs(mp4Path) {
  return new Promise((resolve) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", mp4Path],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {}
    }, FFPROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ durationMs: null, stderr: err?.message ?? stderr, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut || code !== 0) {
        resolve({ durationMs: null, stderr, exitCode: code ?? null });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) ?? {};
        const durationSec = Number(parsed?.format?.duration);
        if (!Number.isFinite(durationSec) || durationSec <= 0) {
          resolve({ durationMs: 0, stderr, exitCode: code ?? null });
          return;
        }
        resolve({ durationMs: Math.round(durationSec * 1000), stderr, exitCode: code ?? null });
      } catch {
        resolve({ durationMs: null, stderr, exitCode: code ?? null });
      }
    });
  });
}

function buildFailureDetail({
  code,
  step,
  exitCode,
  cmd,
  stderr,
  paths,
  sizeBytes,
  ffprobe,
  trace,
  sniff
}) {
  return {
    code,
    step,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    cmd,
    stderrTail: tailText(stderr ?? "", 40, 2400),
    paths,
    sizeBytes: typeof sizeBytes === "number" ? sizeBytes : undefined,
    ffprobe,
    trace,
    sniff
  };
}

function makeErr(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail;
  return error;
}

function throwFailure(detail, summary) {
  throw makeErr(detail?.code ?? "unknown_error", summary, detail);
}

async function runCommandDetailed(cmd, args, env, timeoutMs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, windowsHide: true, cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {}
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, error });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, code, stdout, stderr, error: "timed_out" });
        return;
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function resolveFfmpegCommand(ffmpegPath) {
  if (!ffmpegPath) return "ffmpeg";
  const normalized = ffmpegPath.toLowerCase();
  if (normalized.endsWith("ffmpeg.exe") || normalized.endsWith("ffmpeg")) {
    return ffmpegPath;
  }
  return "ffmpeg";
}

function sniffMp4Header(buffer) {
  if (!buffer || buffer.length === 0) {
    return {
      headHex: "",
      headAscii: "",
      hasFtyp: false,
      hasMoov: false,
      hasMdat: false,
      tailHex: ""
    };
  }
  const slice = buffer.subarray(0, Math.min(buffer.length, 64));
  const headHex = Array.from(slice)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
  const headAscii = Array.from(slice)
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : "."))
    .join("");
  return {
    headHex,
    headAscii,
    hasFtyp: buffer.indexOf("ftyp") !== -1,
    hasMoov: buffer.indexOf("moov") !== -1,
    hasMdat: buffer.indexOf("mdat") !== -1,
    tailHex: ""
  };
}

async function readHeadBytes(filePath, length) {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const { size } = await handle.stat();
      const readLength = Math.min(length, size);
      const buffer = Buffer.alloc(readLength);
      if (readLength > 0) {
        await handle.read(buffer, 0, readLength, 0);
      }
      return buffer;
    } finally {
      await handle.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}

async function readTailBytes(filePath, length) {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const { size } = await handle.stat();
      const readLength = Math.min(length, size);
      const start = Math.max(size - readLength, 0);
      const buffer = Buffer.alloc(readLength);
      if (readLength > 0) {
        await handle.read(buffer, 0, readLength, start);
      }
      return buffer;
    } finally {
      await handle.close();
    }
  } catch {
    return Buffer.alloc(0);
  }
}

function tailHexString(buffer) {
  if (!buffer || buffer.length === 0) return "";
  return Array.from(buffer)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildWorkDirSnapshot(workDir, limit = 80) {
  try {
    const entries = await fs.readdir(workDir, { withFileTypes: true });
    const rows = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(workDir, entry.name);
        try {
          const stat = await fs.stat(full);
          return {
            name: entry.name,
            bytes: stat.size,
            mtime: stat.mtime.toISOString()
          };
        } catch {
          return {
            name: entry.name,
            bytes: 0,
            mtime: null
          };
        }
      })
    );
    rows.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
    return rows.slice(0, limit);
  } catch {
    return [];
  }
}

async function buildExistsMap(paths) {
  const checks = [
    ["previewTmp", paths.outputTmpPath],
    ["previewFinal", paths.outputFinalPath],
    ["avatarPng", paths.avatarPath],
    ["audioInputWav", paths.audioInputPath],
    ["audioNormalizedWav", paths.audioPath],
    ["configYaml", paths.configPath]
  ];
  const out = {};
  for (const [key, value] of checks) {
    if (!value) {
      out[key] = false;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    out[key] = await fileExists(value);
  }
  return out;
}

function normalizeTrace(trace, fallback) {
  if (Array.isArray(trace) && trace.length > 0) return trace;
  return [
    {
      step: "validate_mp4",
      argv: ["validate_mp4", fallback],
      exitCode: null,
      stdoutTail: "",
      stderrTail: "",
      elapsedMs: 0
    }
  ];
}

export function summarizeTrace(detail) {
  if (!detail || !Array.isArray(detail.trace)) return detail;
  let lastWithArgs = null;
  let lastWithStderr = null;
  for (let i = detail.trace.length - 1; i >= 0; i -= 1) {
    const entry = detail.trace[i];
    if (!lastWithArgs && Array.isArray(entry?.argv) && entry.argv.length > 0) {
      lastWithArgs = entry;
    }
    if (!lastWithStderr && typeof entry?.stderrTail === "string" && entry.stderrTail) {
      lastWithStderr = entry;
    }
    if (lastWithArgs && lastWithStderr) break;
  }
  if (!detail.cmd && lastWithArgs) {
    detail.cmd = lastWithArgs.argv.join(" ");
  }
  if (!detail.stderrTail && lastWithStderr) {
    detail.stderrTail = lastWithStderr.stderrTail;
  }
  if (!detail.lastStep && (lastWithArgs?.step || lastWithStderr?.step)) {
    detail.lastStep = lastWithArgs?.step ?? lastWithStderr?.step ?? detail.step;
  }
  return detail;
}

function hasProducerTrace(trace) {
  if (!Array.isArray(trace)) return false;
  const producerSteps = new Set([
    "extract_frame",
    "extract_frame_fallback",
    "normalize_audio",
    "run_musetalk",
    "run_musetalk_override",
    "rename_output"
  ]);
  return trace.some((entry) => producerSteps.has(entry?.step));
}

function setProducerFailFromTrace(detail) {
  if (!detail || !Array.isArray(detail.trace)) return detail;
  const producerSteps = new Set([
    "extract_frame",
    "extract_frame_fallback",
    "normalize_audio",
    "run_musetalk",
    "run_musetalk_override",
    "rename_output"
  ]);
  let candidate = null;
  for (const entry of detail.trace) {
    if (!producerSteps.has(entry?.step)) continue;
    if (!candidate) candidate = entry;
    if (typeof entry?.exitCode === "number" && entry.exitCode !== 0) {
      candidate = entry;
    }
  }
  if (candidate && !detail.producerFail) {
    detail.producerFail = {
      step: candidate.step ?? "unknown",
      cmd: Array.isArray(candidate.argv) ? candidate.argv.join(" ") : "",
      exitCode: typeof candidate.exitCode === "number" ? candidate.exitCode : null,
      stderrTail: candidate.stderrTail ?? ""
    };
  }
  return detail;
}

async function enrichFailureDetail(detail, context) {
  if (!detail || !context) return detail;
  if (!detail.workDirSnapshot && context.workDir) {
    detail.workDirSnapshot = await buildWorkDirSnapshot(context.workDir, 80);
  }
  if (!detail.exists && context.paths) {
    detail.exists = await buildExistsMap(context.paths);
  }
  return detail;
}

function throwInvalidWithProducerCheck(detail, message) {
  if (!hasProducerTrace(detail?.trace)) {
    detail.code = "producer_not_invoked";
    detail.step = "producer_not_invoked";
    throw makeErr(
      "producer_not_invoked",
      "producer_not_invoked: validation ran without producer trace",
      detail
    );
  }
  setProducerFailFromTrace(detail);
  throw makeErr("preview_mp4_invalid", message, detail);
}

async function waitForStableFile(filePath, options = {}) {
  const minBytes = Number.isFinite(options.minBytes) ? options.minBytes : MIN_STABLE_BYTES;
  const stableMs = Number.isFinite(options.stableMs) ? options.stableMs : STABLE_WINDOW_MS;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : STABLE_TIMEOUT_MS;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : STABLE_POLL_MS;
  const sizeHistory = [];
  const start = Date.now();
  let lastSize = -1;
  let stableSince = null;
  let grew = false;

  while (Date.now() - start < timeoutMs) {
    let size = 0;
    try {
      const stat = await fs.stat(filePath);
      size = typeof stat?.size === "number" ? stat.size : 0;
    } catch {
      size = 0;
    }
    const now = Date.now();
    sizeHistory.push({ tMs: now - start, size });
    if (size > lastSize) {
      grew = true;
      stableSince = now;
      lastSize = size;
    }
    if (size >= minBytes) {
      if (stableSince === null) stableSince = now;
      if (now - stableSince >= stableMs) {
        return {
          ok: true,
          sizeHistory,
          waitedMs: now - start,
          grew
        };
      }
    }
    await sleep(pollMs);
  }

  return {
    ok: false,
    sizeHistory,
    waitedMs: Date.now() - start,
    grew
  };
}

export async function computeMp4Diagnostics(outMp4Path, workDir, trace) {
  let sizeBytes = 0;
  try {
    const stat = await fs.stat(outMp4Path);
    sizeBytes = typeof stat?.size === "number" ? stat.size : 0;
  } catch {
    sizeBytes = 0;
  }

  const headBuffer = await readHeadBytes(outMp4Path, SNIFF_BYTES);
  const tailBuffer = await readTailBytes(outMp4Path, TAIL_BYTES);
  const sniff = sniffMp4Header(headBuffer);
  sniff.tailHex = tailHexString(tailBuffer);
  sniff.hasMdat = sniff.hasMdat || tailBuffer.indexOf("mdat") !== -1;
  const probe = await probeMp4DurationMs(outMp4Path);
  const ffprobe = {
    durationMs: Number.isFinite(probe?.durationMs) ? probe.durationMs : probe?.durationMs ?? null,
    stderrTail: tailText(probe?.stderr ?? "", 40, 2000),
    exitCode: typeof probe?.exitCode === "number" ? probe.exitCode : null
  };
  if (!ffprobe.stderrTail && ffprobe.durationMs === null && ffprobe.exitCode === null) {
    ffprobe.stderrTail = "ffprobe_unavailable";
  }

  const normalizedTrace = normalizeTrace(trace, outMp4Path);
  const validateEntryIndex = normalizedTrace.findIndex((entry) => entry.step === "validate_mp4");
  if (validateEntryIndex >= 0 && !normalizedTrace[validateEntryIndex].stderrTail) {
    normalizedTrace[validateEntryIndex].stderrTail = `sizeBytes=${sizeBytes}`;
  }
  normalizedTrace.push({
    step: "ffprobe_out",
    argv: ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", outMp4Path],
    exitCode: ffprobe.exitCode,
    stdoutTail: "",
    stderrTail: ffprobe.stderrTail ?? "",
    elapsedMs: 0
  });

  let textPreview;
  const headText = headBuffer.toString("utf8").replace(/\0/g, "");
  const headTrim = headText.trimStart();
  const isTextLike =
    headTrim.startsWith("{") ||
    headTrim.startsWith("<") ||
    headText.includes("Traceback") ||
    headText.includes("Error");
  if (isTextLike) {
    textPreview = headText.slice(0, 400);
  }

  return {
    step: "validate_mp4",
    sizeBytes,
    paths: { outMp4: outMp4Path, workDir },
    sniff,
    ffprobe,
    trace: normalizedTrace,
    textPreview
  };
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
    runCommand: runCommandOverride,
    sourceVideoPath
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
  const audioInputPath = path.join(workDir, "audio_input.wav");
  const audioPath = path.join(workDir, "audio_normalized.wav");
  const configPath = path.join(workDir, "config.yaml");
  const outputTmpPath = outputPathAbs ?? path.join(workDir, "output.tmp.mp4");
  const outputFinalPath = path.join(workDir, "output.mp4");

  let imageBuffer = Buffer.from(imagePngBase64, "base64");
  const trace = [];
  const env = { ...process.env };
  if (ffmpegPath) {
    env.PATH = `${ffmpegPath}${path.delimiter}${env.PATH || ""}`;
  }
  const ffmpegCmd = resolveFfmpegCommand(ffmpegPath);
  const paths = {
    workDir,
    sourceVideo: sourceVideoPath ?? null,
    refPng: avatarPath,
    normalizedAudio: audioPath,
    outMp4: outputTmpPath
  };
  const failureContext = {
    workDir,
    paths: {
      outputTmpPath,
      outputFinalPath,
      avatarPath,
      audioInputPath,
      audioPath,
      configPath
    }
  };

  const runStep = async (step, cmd, args, { cwd = workDir, timeout = FFPROBE_TIMEOUT_MS } = {}) => {
    const started = Date.now();
    let result;
    if (typeof runCommandOverride === "function" && step === "run_musetalk") {
      try {
        await runCommandOverride(cmd, args, env, timeout, cwd);
        result = { ok: true, code: 0, stdout: "", stderr: "" };
      } catch (error) {
        result = { ok: false, code: null, stdout: "", stderr: String(error) };
      }
    } else {
      result = await runCommandDetailed(cmd, args, env, timeout, cwd);
    }
    const elapsedMs = Date.now() - started;
    const stdoutTail = tailText(result.stdout ?? "", 40, 8000);
    const stderrTail = tailText(result.stderr ?? "", 40, 8000);
    trace.push({
      step,
      argv: [cmd, ...args],
      exitCode: typeof result.code === "number" ? result.code : null,
      stdoutTail,
      stderrTail,
      elapsedMs
    });
    return { ...result, stdoutTail, stderrTail, elapsedMs };
  };

  const modelPaths = resolveModelPaths(modelsDir, version);
  const missing = [];
  if (!existsSync(modelsDir)) missing.push(`modelsDir:${modelsDir}`);
  if (!existsSync(modelPaths.unetModel)) missing.push(`unetModel:${modelPaths.unetModel}`);
  if (!existsSync(modelPaths.unetConfig)) missing.push(`unetConfig:${modelPaths.unetConfig}`);
  if (!existsSync(scriptPath)) missing.push(`script:${scriptPath}`);
  trace.push({
    step: "preflight",
    argv: [],
    exitCode: missing.length === 0 ? 0 : 1,
    stdoutTail: "",
    stderrTail: missing.join("; "),
    elapsedMs: 0
  });
  if (missing.length > 0) {
    const detail = await enrichFailureDetail(
      buildFailureDetail({
      code: "musetalk_not_configured",
      step: "preflight",
      exitCode: 1,
      cmd: "",
      stderr: missing.join("; "),
      paths,
      trace
      }),
      failureContext
    );
    detail.producerFail = {
      step: "preflight",
      cmd: "",
      exitCode: 1,
      stderrTail: detail.stderrTail ?? ""
    };
    throwFailure(detail, "musetalk_not_configured");
  }
  if (sourceVideoPath) {
    const frameArgs = ["-y", "-ss", "00:00:01", "-i", sourceVideoPath, "-frames:v", "1", avatarPath];
    let frameResult = await runStep("extract_frame", ffmpegCmd, frameArgs);
    if (!frameResult.ok) {
      const fallbackArgs = ["-y", "-ss", "00:00:00", "-i", sourceVideoPath, "-frames:v", "1", avatarPath];
      frameResult = await runStep("extract_frame_fallback", ffmpegCmd, fallbackArgs);
      if (!frameResult.ok) {
        const cmdLabel = formatCmd(ffmpegCmd, fallbackArgs);
        const detail = await enrichFailureDetail(
          buildFailureDetail({
          code: "extract_frame_failed",
          step: "extract_frame",
          exitCode: frameResult.code,
          cmd: cmdLabel,
          stderr: frameResult.stderr,
          paths,
          trace
          }),
          failureContext
        );
        detail.producerFail = {
          step: "extract_frame",
          cmd: cmdLabel,
          exitCode: typeof frameResult.code === "number" ? frameResult.code : null,
          stderrTail: detail.stderrTail ?? ""
        };
        throwFailure(
          detail,
          formatFailure({
            step: "extract_frame",
            code: frameResult.code,
            stderr: frameResult.stderr,
            cmd: cmdLabel,
            error: frameResult.error
          })
        );
      }
    }
    imageBuffer = await fs.readFile(avatarPath);
  } else {
    await fs.writeFile(avatarPath, imageBuffer);
  }
  await fs.writeFile(audioInputPath, Buffer.from(audioWavBase64, "base64"));

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
    outputPath: outputTmpPath,
    modelsDir,
    preparedDir: preparedDir ?? avatarDir
  });
  await fs.writeFile(configPath, config, "utf8");

  const normalizeArgs = [
    "-y",
    "-i",
    audioInputPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    audioPath
  ];
  const normalizeResult = await runStep("normalize_audio", ffmpegCmd, normalizeArgs);
  if (!normalizeResult.ok) {
    const cmdLabel = formatCmd(ffmpegCmd, normalizeArgs);
    const detail = await enrichFailureDetail(
      buildFailureDetail({
      code: "normalize_audio_failed",
      step: "normalize_audio",
      exitCode: normalizeResult.code,
      cmd: cmdLabel,
      stderr: normalizeResult.stderr,
      paths,
      trace
      }),
      failureContext
    );
    detail.producerFail = {
      step: "normalize_audio",
      cmd: cmdLabel,
      exitCode: typeof normalizeResult.code === "number" ? normalizeResult.code : null,
      stderrTail: detail.stderrTail ?? ""
    };
    throwFailure(
      detail,
      formatFailure({
        step: "normalize_audio",
        code: normalizeResult.code,
        stderr: normalizeResult.stderr,
        cmd: cmdLabel,
        error: normalizeResult.error
      })
    );
  }

  const args = buildMuseTalkArgs({
    configPath,
    version,
    modelsDir,
    ffmpegPath,
    fps
  });
  let lastRunCmd = formatCmd(pythonBin, args);
  let lastRunStderr = "";
  let lastRunExitCode = null;
  const result = await runStep("run_musetalk", pythonBin, args, {
    cwd: repoDir,
    timeout: timeoutMs
  });
  lastRunCmd = formatCmd(pythonBin, args);
  lastRunStderr = result.stderr ?? "";
  lastRunExitCode = typeof result.code === "number" ? result.code : null;
  if (!result.ok) {
    const detail = await enrichFailureDetail(
      buildFailureDetail({
        code: "run_musetalk_failed",
        step: "run_musetalk",
        exitCode: result.code,
        cmd: lastRunCmd,
        stderr: result.stderr,
        paths,
        trace
      }),
      failureContext
    );
    detail.producerFail = {
      step: "run_musetalk",
      cmd: lastRunCmd,
      exitCode: typeof result.code === "number" ? result.code : null,
      stderrTail: detail.stderrTail ?? ""
    };
    throwFailure(
      detail,
      formatFailure({
        step: "run_musetalk",
        code: result.code,
        stderr: result.stderr,
        cmd: lastRunCmd
      })
    );
  }
  const expectedMp4 = resolveOutputMp4(repoDir, version, avatarKey);
  const hasTmp = await fileExists(outputTmpPath);
  const candidateMp4 = hasTmp ? outputTmpPath : await findOutputMp4(expectedMp4, workDir);
  if (!candidateMp4) {
    const detail = await enrichFailureDetail(
      buildFailureDetail({
      code: "musetalk_output_missing",
      step: "locate_output",
      exitCode: lastRunExitCode,
      cmd: lastRunCmd,
      stderr: lastRunStderr,
      paths: { ...paths, outMp4: expectedMp4 },
      trace
      }),
      failureContext
    );
    throwFailure(detail, "musetalk_output_missing");
  }

  const waitResult = await waitForStableFile(candidateMp4, {
    minBytes: MIN_STABLE_BYTES,
    stableMs: STABLE_WINDOW_MS,
    timeoutMs: STABLE_TIMEOUT_MS,
    pollMs: STABLE_POLL_MS
  });
  trace.push({
    step: "wait_for_complete",
    argv: ["wait_for_complete", candidateMp4],
    exitCode: waitResult.ok ? 0 : 1,
    stdoutTail: "",
    stderrTail: `waitedMs=${waitResult.waitedMs} grew=${waitResult.grew}`,
    elapsedMs: waitResult.waitedMs
  });
  if (!waitResult.ok) {
    const diagnostics = await computeMp4Diagnostics(candidateMp4, workDir, trace);
    const detail = await enrichFailureDetail(
      {
      code: "preview_mp4_invalid",
      step: "wait_for_complete",
      sizeBytes: diagnostics.sizeBytes,
      paths: diagnostics.paths,
      sniff: diagnostics.sniff,
      ffprobe: diagnostics.ffprobe,
      trace: diagnostics.trace,
      textPreview: diagnostics.textPreview,
      sizeHistory: waitResult.sizeHistory,
      waitedMs: waitResult.waitedMs,
      grew: waitResult.grew
      },
      failureContext
    );
    summarizeTrace(detail);
    setProducerFailFromTrace(detail);
    throwInvalidWithProducerCheck(detail, "preview_mp4_invalid: wait_for_complete");
  }

  const diagnostics = await computeMp4Diagnostics(candidateMp4, workDir, trace);
  const sizeBytes = diagnostics.sizeBytes ?? 0;
  if (!sizeBytes || sizeBytes < MIN_PREVIEW_BYTES) {
    const detail = await enrichFailureDetail(
      {
      code: "preview_mp4_invalid",
      step: "validate_size",
      sizeBytes,
      paths: diagnostics.paths,
      sniff: diagnostics.sniff,
      ffprobe: diagnostics.ffprobe,
      trace: diagnostics.trace,
      textPreview: diagnostics.textPreview
      },
      failureContext
    );
    summarizeTrace(detail);
    setProducerFailFromTrace(detail);
    throwInvalidWithProducerCheck(detail, `preview_mp4_invalid: size=${sizeBytes}`);
  }

  let finalMp4 = candidateMp4;
  const mp4Buffer = await fs.readFile(candidateMp4);
  const hasFtyp = mp4Buffer.indexOf("ftyp") !== -1;
  const hasMoov = hasMoovAtom(mp4Buffer);
  if (!hasFtyp || !hasMoov) {
    const detail = await enrichFailureDetail(
      {
      code: "preview_mp4_invalid",
      step: "validate_atoms",
      sizeBytes,
      paths: diagnostics.paths,
      sniff: diagnostics.sniff,
      ffprobe: diagnostics.ffprobe,
      trace: diagnostics.trace,
      textPreview: diagnostics.textPreview
      },
      failureContext
    );
    summarizeTrace(detail);
    setProducerFailFromTrace(detail);
    throwInvalidWithProducerCheck(detail, "preview_mp4_invalid: atoms_missing");
  }

  let durationMs = diagnostics.ffprobe?.durationMs;
  if (!durationMs || durationMs < MIN_DURATION_MS) {
    const parsedDuration = parseMvhdDurationMs(mp4Buffer);
    if (Number.isFinite(parsedDuration) && parsedDuration >= MIN_DURATION_MS) {
      durationMs = parsedDuration;
    }
  }
  if (candidateMp4 === outputTmpPath) {
    try {
      if (await fileExists(outputFinalPath)) {
        await fs.rm(outputFinalPath, { force: true });
      }
      await fs.rename(outputTmpPath, outputFinalPath);
      trace.push({
        step: "rename_output",
        argv: ["rename", outputTmpPath, outputFinalPath],
        exitCode: 0,
        stdoutTail: "",
        stderrTail: "",
        elapsedMs: 0
      });
      finalMp4 = outputFinalPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      trace.push({
        step: "rename_output",
        argv: ["rename", outputTmpPath, outputFinalPath],
        exitCode: 1,
        stdoutTail: "",
        stderrTail: message,
        elapsedMs: 0
      });
      const detail = await enrichFailureDetail(
        {
          code: "preview_mp4_invalid",
          step: "rename_output",
          sizeBytes,
          paths: diagnostics.paths,
          sniff: diagnostics.sniff,
          ffprobe: diagnostics.ffprobe,
          trace,
          textPreview: diagnostics.textPreview
        },
        failureContext
      );
      summarizeTrace(detail);
      setProducerFailFromTrace(detail);
      throwInvalidWithProducerCheck(detail, "preview_mp4_invalid: rename_failed");
    }
  }
  if (!durationMs || durationMs < MIN_DURATION_MS) {
    const reported = Number.isFinite(durationMs) ? durationMs : 0;
    const detail = await enrichFailureDetail(
      {
      code: "preview_mp4_invalid",
      step: "validate_duration",
      sizeBytes,
      paths: diagnostics.paths,
      sniff: diagnostics.sniff,
      ffprobe: diagnostics.ffprobe,
      trace: diagnostics.trace,
      textPreview: diagnostics.textPreview
      },
      failureContext
    );
    summarizeTrace(detail);
    setProducerFailFromTrace(detail);
    throwInvalidWithProducerCheck(
      detail,
      `preview_mp4_invalid: duration_zero=${reported}`
    );
  }
  if (preparation) {
    await fs.mkdir(avatarDir, { recursive: true });
    await fs.writeFile(hashFile, desiredHash, "utf8");
  }
  return {
    mp4Buffer,
    durationMs: durationMs ?? undefined,
    mp4Path: finalMp4,
    preparedDir: avatarDir,
    avatarKey,
    workDir
  };
}
