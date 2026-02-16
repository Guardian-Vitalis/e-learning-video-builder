import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { PrepCache, buildPrepKey } from "./prepCache.js";
import { getDoctorHealth } from "./doctorHealth.js";
import { loadEnvForDoctor } from "./doctorEnv.js";
import { SAMPLE_MP4_BASE64 } from "./sampleMp4Base64.js";
import {
  runMuseTalkClip,
  computeMp4Diagnostics,
  summarizeTrace,
  buildAvatarKey
} from "./musetalkRunner.js";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), "..");
const repoRoot = path.resolve(packageRoot, "..");

const envCandidates = [
  path.join(packageRoot, ".env.local"),
  path.join(packageRoot, ".env"),
  path.join(repoRoot, ".env.local"),
  path.join(repoRoot, ".env")
];
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}
const { env: runtimeEnv } = loadEnvForDoctor({
  repoRoot,
  packageRoot,
  baseEnv: { ...process.env }
});

const PORT = Number(runtimeEnv.EVB_LOCAL_AVATAR_PORT || 5600);

const CACHE_DIR = runtimeEnv.EVB_LOCAL_AVATAR_CACHE_DIR
  ? path.resolve(runtimeEnv.EVB_LOCAL_AVATAR_CACHE_DIR)
  : path.resolve(process.cwd(), "data", "local-avatar-cache");

const WORK_ROOT = runtimeEnv.EVB_LOCAL_AVATAR_WORK_DIR
  ? path.resolve(runtimeEnv.EVB_LOCAL_AVATAR_WORK_DIR)
  : path.resolve(process.cwd(), "data", "local-avatar-work");

const IMPL = (runtimeEnv.EVB_LOCAL_AVATAR_IMPL || "stub").toLowerCase();

function resolveMuseTalkRepoDir() {
  const candidates = [
    path.join(packageRoot, "vendor", "MuseTalk"),
    path.join(packageRoot, "..", "MuseTalk"),
    path.join(repoRoot, "vendor", "MuseTalk"),
    path.join(repoRoot, "MuseTalk")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveMuseTalkModelsDir(repoDir) {
  if (!repoDir) return null;
  const candidates = [
    path.join(repoDir, "models"),
    path.join(repoDir, "checkpoints"),
    path.join(repoDir, "weights")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function isPathLike(value) {
  return typeof value === "string" && (value.includes("\\") || value.includes("/"));
}

const MUSETALK_REPO_DIR = runtimeEnv.EVB_MUSETALK_REPO_DIR || resolveMuseTalkRepoDir();
const MUSETALK_PYTHON =
  runtimeEnv.EVB_MUSETALK_PYTHON || runtimeEnv.EVB_PYTHON_BIN || "python";
const MUSETALK_VERSION = runtimeEnv.EVB_MUSETALK_VERSION || "v15";

const MUSETALK_MODELS_DIR =
  runtimeEnv.EVB_MUSETALK_MODELS_DIR ||
  (MUSETALK_REPO_DIR ? resolveMuseTalkModelsDir(MUSETALK_REPO_DIR) : undefined);

const MUSETALK_FFMPEG_PATH = runtimeEnv.EVB_MUSETALK_FFMPEG_PATH;
const MUSETALK_TIMEOUT_MS = Number(runtimeEnv.EVB_MUSETALK_TIMEOUT_MS || 120000);

const MAX_JSON_BYTES = Number(
  runtimeEnv.EVB_LOCAL_AVATAR_MAX_JSON_BYTES || 50 * 1024 * 1024
);

// IMPORTANT: use real conda.exe on Windows
const CONDA_EXE = runtimeEnv.EVB_CONDA_EXE || process.env.CONDA_EXE || "conda";

// Self-test config
const HEALTH_ENV_NAME = runtimeEnv.EVB_LOCAL_AVATAR_CONDA_ENV || "MuseTalk";
const SELFTEST_TIMEOUT_MS = Number(
  runtimeEnv.EVB_LOCAL_AVATAR_SELFTEST_TIMEOUT_MS || 180000
);

const cache = new PrepCache({ cacheDir: CACHE_DIR });
const jobs = new Map();
const jobQueue = [];
let queueRunning = false;

const MIN_PREVIEW_BYTES = 50 * 1024;
const MIN_DURATION_MS = 250;
const ENGINE_BUILD_ID = "diag-ready-v2";
const PREP_CACHE_VERSION = "v2";
const REQUIRED_JOB_FIELDS = ["jobId", "clipId", "imagePngBase64"];

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length, Content-Type, X-Request-Id, X-RequestId, X-EVB-Engine-Build"
  );
}

function respondJson(res, statusCode, body) {
  res.statusCode = statusCode;
  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function toErrorDetail(err, fallback) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

async function ensureDirs() {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  await fs.promises.mkdir(path.dirname(WORK_ROOT), { recursive: true });
  await fs.promises.mkdir(WORK_ROOT, { recursive: true });
}

function listReceivedKeys(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  return Object.keys(body);
}

export function buildInvalidRequestPayload(body, contentType) {
  return {
    error: "invalid_request",
    required: REQUIRED_JOB_FIELDS,
    receivedKeys: listReceivedKeys(body),
    contentType: contentType || "",
    hint: "PowerShell Invoke-RestMethod requires -Body JSON string; ensure payloadJson is not empty."
  };
}

async function ensureDirsOrRespond(res) {
  try {
    await ensureDirs();
    return true;
  } catch (err) {
    respondJson(res, 500, {
      error: "server_misconfigured",
      detail: toErrorDetail(err, "Failed to create local avatar work/cache directories."),
      engineBuildId: ENGINE_BUILD_ID
    });
    return false;
  }
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (Number.isFinite(MAX_JSON_BYTES) && total > MAX_JSON_BYTES) {
      throw new Error("payload_too_large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }
}

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function parseMultipart(buffer, boundary) {
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(boundaryMarker, cursor);
    if (start === -1) break;
    const next = buffer.indexOf(boundaryMarker, start + boundaryMarker.length);
    const partEnd = next === -1 ? buffer.length : next;
    const part = buffer.slice(start + boundaryMarker.length, partEnd);
    parts.push(part);
    if (next === -1) break;
    cursor = next;
  }
  const fields = {};
  const files = {};
  for (const part of parts) {
    const cleaned = part.slice(part.indexOf("\r\n") + 2);
    const headerEnd = cleaned.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerText = cleaned.slice(0, headerEnd).toString("utf8");
    const body = cleaned.slice(headerEnd + 4, cleaned.length - 2);
    const disposition = headerText
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().startsWith("content-disposition"));
    if (!disposition) continue;
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const fileMatch = disposition.match(/filename="([^"]*)"/i);
    if (fileMatch && fileMatch[1]) {
      files[name] = {
        filename: fileMatch[1],
        buffer: body
      };
      continue;
    }
    fields[name] = body.toString("utf8");
  }
  return { fields, files };
}

function hashInputSignature({ imagePngBase64, audioBase64, sourceVideoPath }) {
  const hash = crypto.createHash("sha256");
  if (imagePngBase64) {
    const imageBuffer = Buffer.from(imagePngBase64, "base64");
    hash.update(imageBuffer.subarray(0, Math.min(imageBuffer.length, 256 * 1024)));
    hash.update(String(imageBuffer.length));
  }
  if (audioBase64) {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    hash.update(audioBuffer.subarray(0, Math.min(audioBuffer.length, 256 * 1024)));
    hash.update(String(audioBuffer.length));
  }
  if (sourceVideoPath) {
    try {
      const fd = fs.openSync(sourceVideoPath, "r");
      const stats = fs.statSync(sourceVideoPath);
      const limit = Math.min(stats.size, 1024 * 1024);
      const temp = Buffer.alloc(limit);
      fs.readSync(fd, temp, 0, limit, 0);
      fs.closeSync(fd);
      hash.update(temp);
      hash.update(String(stats.size));
    } catch {
      // ignore
    }
  }
  return hash.digest("hex").slice(0, 12);
}

function jobKey(jobId, clipId) {
  return `${jobId}:${clipId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=") || rangeHeader.includes(",")) {
    return null;
  }
  const value = rangeHeader.replace("bytes=", "").trim();
  const [startRaw, endRaw] = value.split("-");
  const start = startRaw ? Number(startRaw) : NaN;
  const end = endRaw ? Number(endRaw) : NaN;

  if (!Number.isNaN(start) && startRaw && start < 0) {
    return null;
  }
  if (!Number.isNaN(end) && endRaw && end < 0) {
    return null;
  }

  let rangeStart;
  let rangeEnd;

  if (startRaw && endRaw) {
    rangeStart = start;
    rangeEnd = end;
  } else if (startRaw && !endRaw) {
    rangeStart = start;
    rangeEnd = size - 1;
  } else if (!startRaw && endRaw) {
    const suffixLength = end;
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    rangeStart = Math.max(size - suffixLength, 0);
    rangeEnd = size - 1;
  } else {
    return null;
  }

  if (
    Number.isNaN(rangeStart) ||
    Number.isNaN(rangeEnd) ||
    rangeStart > rangeEnd ||
    rangeStart >= size
  ) {
    return null;
  }

  if (rangeEnd >= size) {
    rangeEnd = size - 1;
  }

  return { start: rangeStart, end: rangeEnd, chunkSize: rangeEnd - rangeStart + 1 };
}

async function ensureStubPreviewFile(prepKey) {
  const safeKey = prepKey ? String(prepKey).replace(/[^a-z0-9_-]/gi, "_") : "stub";
  const dir = path.join(CACHE_DIR, safeKey);
  const mp4Path = path.join(dir, "preview.mp4");
  try {
    await fs.promises.access(mp4Path);
    return mp4Path;
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
    const buffer = Buffer.from(SAMPLE_MP4_BASE64, "base64");
    await fs.promises.writeFile(mp4Path, buffer);
    return mp4Path;
  }
}

function validateMuseTalkEnv() {
  const missing = [];
  if (!MUSETALK_REPO_DIR && !MUSETALK_MODELS_DIR) {
    missing.push("EVB_MUSETALK_REPO_DIR or EVB_MUSETALK_MODELS_DIR");
  }
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

function isPreviewDetailComplete(detail) {
  if (!detail) return false;
  if (!Array.isArray(detail.trace) || detail.trace.length === 0) return false;
  if (!detail.sniff) return false;
  if (!detail.ffprobe) return false;
  return true;
}

async function buildPreviewInvalidDetail({ mp4Path, workDir, trace, step }) {
  const resolvedWorkDir =
    workDir ?? (mp4Path ? path.dirname(mp4Path) : null);
  const diagnostics = await computeMp4Diagnostics(mp4Path, resolvedWorkDir, trace);
  return {
    code: "preview_mp4_invalid",
    step: step ?? diagnostics.step,
    sizeBytes: diagnostics.sizeBytes,
    paths: diagnostics.paths,
    sniff: diagnostics.sniff,
    ffprobe: diagnostics.ffprobe,
    trace: diagnostics.trace
  };
}

function buildMissingPreviewDetail({ workDir }) {
  return {
    code: "preview_mp4_invalid",
    step: "validate_missing",
    sizeBytes: 0,
    paths: {
      outMp4: null,
      workDir: workDir ?? null
    },
    sniff: {
      headHex: "",
      headAscii: "",
      hasFtyp: false,
      hasMoov: false,
      error: "file_missing"
    },
    ffprobe: {
      durationMs: null,
      stderrTail: "file_missing",
      exitCode: null
    },
    trace: [
      {
        step: "validate_missing",
        argv: ["validate_missing"],
        exitCode: null,
        stdoutTail: "",
        stderrTail: "file_missing",
        elapsedMs: 0
      }
    ]
  };
}

function mergePreviewDetail(existing, diagnostics) {
  const merged = { ...(diagnostics ?? {}), ...(existing ?? {}) };
  const mergedPaths = existing?.paths
    ? { ...existing.paths }
    : { ...(diagnostics?.paths ?? {}) };
  if (!mergedPaths?.workDir && diagnostics?.paths?.workDir) {
    mergedPaths.workDir = diagnostics.paths.workDir;
  }
  if (!mergedPaths?.outMp4 && diagnostics?.paths?.outMp4) {
    mergedPaths.outMp4 = diagnostics.paths.outMp4;
  }
  merged.paths = mergedPaths;
  if (!merged.sniff && diagnostics?.sniff) merged.sniff = diagnostics.sniff;
  if (!merged.ffprobe && diagnostics?.ffprobe) merged.ffprobe = diagnostics.ffprobe;
  const existingTrace = Array.isArray(existing?.trace) ? existing.trace : [];
  const diagTrace = Array.isArray(diagnostics?.trace) ? diagnostics.trace : [];
  if (existingTrace.length === 0 && diagTrace.length === 0) {
    merged.trace = [];
  } else {
    const seen = new Set();
    const mergedTrace = [];
    for (const entry of existingTrace) {
      const key = `${entry?.step ?? ""}|${JSON.stringify(entry?.argv ?? [])}`;
      if (!seen.has(key)) {
        seen.add(key);
        mergedTrace.push(entry);
      }
    }
    for (const entry of diagTrace) {
      const key = `${entry?.step ?? ""}|${JSON.stringify(entry?.argv ?? [])}`;
      if (!seen.has(key)) {
        seen.add(key);
        mergedTrace.push(entry);
      }
    }
    merged.trace = mergedTrace;
  }
  return merged;
}

function normalizeDetailFromTrace(detail) {
  if (!detail || !Array.isArray(detail.trace)) return detail;
  return summarizeTrace(detail);
}

function buildDetailSummary(detail) {
  if (!detail) return "";
  const step = detail.lastStep ?? detail.step ?? "unknown";
  const sniff = detail.sniff ?? {};
  const ffprobe = detail.ffprobe ?? {};
  const mdat =
    typeof sniff.hasMdat === "boolean" ? `mdat=${sniff.hasMdat}` : "mdat=unknown";
  const moov =
    typeof sniff.hasMoov === "boolean" ? `moov=${sniff.hasMoov}` : "moov=unknown";
  const ftyp =
    typeof sniff.hasFtyp === "boolean" ? `ftyp=${sniff.hasFtyp}` : "ftyp=unknown";
  let probePart = "ffprobe=unknown";
  if (Number.isFinite(ffprobe.durationMs)) {
    probePart = `durationMs=${ffprobe.durationMs}`;
  } else if (typeof ffprobe.exitCode === "number") {
    probePart = `ffprobeExit=${ffprobe.exitCode}`;
  }
  return `${step} | ${ftyp} ${moov} ${mdat} | ${probePart}`;
}

function ensureDetailSummary(detail) {
  if (!detail) return detail;
  if (!detail.summary) {
    detail.summary = buildDetailSummary(detail);
  }
  return detail;
}

function isMp4DiagnosticValid(detail) {
  if (!detail) return false;
  if (!detail.sizeBytes || detail.sizeBytes < MIN_PREVIEW_BYTES) return false;
  const durationMs = detail.ffprobe?.durationMs;
  if (!Number.isFinite(durationMs)) return true;
  return durationMs >= MIN_DURATION_MS;
}

function isPreviewCacheValid(detail) {
  if (!detail) return false;
  if (!detail.sizeBytes || detail.sizeBytes < MIN_PREVIEW_BYTES) return false;
  if (!detail.sniff?.hasFtyp || !detail.sniff?.hasMoov) return false;
  const durationMs = detail.ffprobe?.durationMs;
  if (!Number.isFinite(durationMs)) return false;
  return durationMs >= MIN_DURATION_MS;
}

function buildCacheDecision({ hit, dir, action }) {
  return {
    hit: Boolean(hit),
    version: PREP_CACHE_VERSION,
    dir: dir ?? null,
    action
  };
}

function attachCacheDetail(detail, record) {
  if (!detail || !record?.meta?.cacheDecision) return detail;
  if (!detail.cache) {
    detail.cache = record.meta.cacheDecision;
  }
  return detail;
}

function pickRecordTimestamp(record) {
  const value = record?.updatedAt ?? record?.createdAt ?? null;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function findLatestRecordByPrepKey(prepKey, excludeRecord) {
  if (!prepKey) return null;
  let latest = null;
  let latestTs = 0;
  for (const record of jobs.values()) {
    if (excludeRecord && record === excludeRecord) continue;
    if (record?.prepKey !== prepKey) continue;
    const ts = pickRecordTimestamp(record);
    if (!latest || ts > latestTs) {
      latest = record;
      latestTs = ts;
    }
  }
  return latest;
}

function runCmdCaptureJson(exe, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      shell: false
    });

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

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${exe} timed out`));
        return;
      }
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function runCmdCaptureText(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      shell: false
    });
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
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: err?.message ?? stderr, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, code, stdout, stderr, timedOut: true });
        return;
      }
      resolve({ ok: code === 0, code, stdout, stderr, timedOut: false });
    });
  });
}

function runCondaJson(args, timeoutMs) {
  return runCmdCaptureJson(CONDA_EXE, args, timeoutMs);
}

function buildSelfTestScript() {
  return [
    "import json, importlib, sys",
    "mods = ['torch','diffusers','transformers','huggingface_hub','mmcv','mmpose','mmdet']",
    "versions = {}",
    "missing = []",
    "for name in mods:",
    "    try:",
    "        mod = importlib.import_module(name)",
    "        versions[name] = getattr(mod, '__version__', 'unknown')",
    "    except Exception as e:",
    "        missing.append(f\"{name}: {e}\")",
    "if missing:",
    "    print(json.dumps({'ok': False, 'error': 'import_failed', 'detail': '; '.join(missing)}))",
    "    sys.exit(1)",
    "print(json.dumps({'ok': True, 'versions': versions}))"
  ].join("\n");
}

async function runSelfTest() {
  const script = buildSelfTestScript();

  // Preferred path: run env python directly (fast, avoids conda wrappers)
  const py = MUSETALK_PYTHON;
  const looksLikePath = typeof py === "string" && (py.includes("\\") || py.includes("/"));
  const pyExists = looksLikePath && fs.existsSync(py);

  if (pyExists) {
    try {
      const { code, stdout, stderr } = await runCmdCaptureJson(
        py,
        ["-c", script],
        SELFTEST_TIMEOUT_MS
      );

      if (stdout) {
        const parsed = JSON.parse(stdout);
        if (parsed?.ok === true) return { ok: true, versions: parsed.versions ?? {} };
        if (parsed?.ok === false) {
          return { ok: false, error: parsed.error ?? "import_failed", detail: parsed.detail ?? stderr };
        }
      }

      if (code === 0) return { ok: true, versions: {} };
      return { ok: false, error: "python_self_test_failed", detail: stderr || stdout || "python failed" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: "python_unavailable",
        detail: message,
        hint: "EVB_MUSETALK_PYTHON points to a file that exists, but could not be executed."
      };
    }
  }

  // Fallback path: conda.exe run (requires real conda.exe)
  try {
    const { code, stdout, stderr } = await runCondaJson(
      ["run", "-n", HEALTH_ENV_NAME, "python", "-c", script],
      SELFTEST_TIMEOUT_MS
    );

    if (stdout) {
      const parsed = JSON.parse(stdout);
      if (parsed?.ok === true) return { ok: true, versions: parsed.versions ?? {} };
      if (parsed?.ok === false) {
        return { ok: false, error: parsed.error ?? "import_failed", detail: parsed.detail ?? stderr };
      }
    }

    if (code === 0) return { ok: true, versions: {} };
    return { ok: false, error: "conda_self_test_failed", detail: stderr || stdout || "conda failed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: "conda_unavailable",
      detail: message,
      hint:
        "Set EVB_CONDA_EXE to a real conda.exe path and/or increase EVB_LOCAL_AVATAR_SELFTEST_TIMEOUT_MS. " +
        "On Windows, do not rely on the PowerShell 'conda' function."
    };
  }
}

async function runReadinessChecks() {
  const checks = [];
  const reasons = [];
  const suggestedFix = [];
  const timeoutMs = 8000;
  const pythonExe = runtimeEnv.EVB_PYTHON_BIN || MUSETALK_PYTHON || "python";

  const ffmpegRes = await runCmdCaptureText("ffmpeg", ["-version"], timeoutMs);
  checks.push({
    name: "ffmpeg",
    ok: ffmpegRes.ok,
    detail: ffmpegRes.ok ? ffmpegRes.stdout.split(/\r?\n/)[0] : ffmpegRes.stderr
  });
  if (!ffmpegRes.ok) reasons.push("ffmpeg not available on PATH");

  const ffprobeRes = await runCmdCaptureText("ffprobe", ["-version"], timeoutMs);
  checks.push({
    name: "ffprobe",
    ok: ffprobeRes.ok,
    detail: ffprobeRes.ok ? ffprobeRes.stdout.split(/\r?\n/)[0] : ffprobeRes.stderr
  });
  if (!ffprobeRes.ok) reasons.push("ffprobe not available on PATH");

  const pythonRes = await runCmdCaptureText(pythonExe, ["--version"], timeoutMs);
  checks.push({
    name: "python",
    ok: pythonRes.ok,
    detail: pythonRes.ok ? pythonRes.stdout.trim() || pythonRes.stderr.trim() : pythonRes.stderr
  });
  if (!pythonRes.ok) reasons.push("python not available");

  const importRes = await runCmdCaptureText(
    pythonExe,
    ["-c", "import torch, cv2; print('ok')"],
    timeoutMs
  );
  checks.push({
    name: "python_imports",
    ok: importRes.ok,
    detail: importRes.ok ? "torch, cv2 ok" : importRes.stderr || importRes.stdout
  });
  if (!importRes.ok) reasons.push("python imports failed (torch/cv2)");

  const repoOk = Boolean(MUSETALK_REPO_DIR && fs.existsSync(MUSETALK_REPO_DIR));
  checks.push({
    name: "musetalk_repo",
    ok: repoOk,
    detail: repoOk ? MUSETALK_REPO_DIR : "missing EVB_MUSETALK_REPO_DIR"
  });
  if (!repoOk) reasons.push("MuseTalk repo path missing");

  const modelsDir = MUSETALK_MODELS_DIR;
  const modelsOk = Boolean(modelsDir && fs.existsSync(modelsDir));
  checks.push({
    name: "musetalk_models_dir",
    ok: modelsOk,
    detail: modelsOk ? modelsDir : "missing EVB_MUSETALK_MODELS_DIR"
  });
  if (!modelsOk) reasons.push("MuseTalk models directory missing");

  if (modelsOk) {
    const modelPaths = (() => {
      if (MUSETALK_VERSION === "v15") {
        return {
          unetModel: path.join(modelsDir, "musetalkV15", "unet.pth"),
          unetConfig: path.join(modelsDir, "musetalkV15", "musetalk.json")
        };
      }
      return {
        unetModel: path.join(modelsDir, "musetalk", "pytorch_model.bin"),
        unetConfig: path.join(modelsDir, "musetalk", "musetalk.json")
      };
    })();
    const unetOk = fs.existsSync(modelPaths.unetModel);
    const configOk = fs.existsSync(modelPaths.unetConfig);
    checks.push({
      name: "musetalk_models_files",
      ok: unetOk && configOk,
      detail: `unet=${unetOk} config=${configOk}`
    });
    if (!unetOk || !configOk) reasons.push("MuseTalk model files missing");
  }

  if (!pythonRes.ok || !importRes.ok) {
    const venvRoot = path.join(packageRoot, ".venv");
    const venvPy = path.join(venvRoot, "Scripts", "python.exe");
    const repoDir = MUSETALK_REPO_DIR ?? resolveMuseTalkRepoDir() ?? "<PATH_TO_MUSETALK>";
    const modelDir =
      MUSETALK_MODELS_DIR ?? resolveMuseTalkModelsDir(repoDir) ?? "<PATH_TO_MODELS>";
    suggestedFix.push(
      `py -3.11 -m venv "${venvRoot}"`,
      `"${venvPy}" -m pip install --upgrade pip`,
      `"${venvPy}" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu`,
      `"${venvPy}" -m pip install opencv-python`,
      `Set-Content -Path "${path.join(packageRoot, ".env.local")}" -Value @'\nEVB_PYTHON_BIN=${venvPy}\nEVB_MUSETALK_REPO_DIR=${repoDir}\nEVB_MUSETALK_MODELS_DIR=${modelDir}\n'@`
    );
  }

  const ready = reasons.length === 0;
  return {
    ready,
    checks,
    reasons,
    suggestedFix,
    detected: {
      pythonBin: pythonExe,
      pythonVersion: pythonRes.stdout.trim() || pythonRes.stderr.trim() || null
    }
  };
}

async function runQueuedJob(input) {
  const key = jobKey(input.jobId, input.clipId);
  const entry = jobs.get(key);
  if (!entry) return;

  try {
    await runJob(input);
  } catch (err) {
    const detail = err?.detail ?? null;
    const code =
      (typeof err?.code === "string" && err.code) ||
      (typeof detail?.code === "string" && detail.code) ||
      "unknown_error";
    const reason =
      (typeof err?.reason === "string" && err.reason) ||
      (typeof err?.message === "string" && err.message) ||
      String(err);
    entry.status = "failed";
    entry.updatedAt = nowIso();
    entry.error = reason;
    entry.errorCode = code;
    entry.errorDetail = attachCacheDetail(
      ensureDetailSummary(normalizeDetailFromTrace(detail)),
      entry
    );
    if (detail?.paths) {
      if (!entry.meta?.mp4Path && detail.paths.outMp4) {
        entry.meta.mp4Path = detail.paths.outMp4;
      }
      if (!entry.meta?.workDir && detail.paths.workDir) {
        entry.meta.workDir = detail.paths.workDir;
      }
    }
    const step = typeof detail?.step === "string" ? detail.step : "unknown";
    const outMp4 = detail?.paths?.outMp4 ?? "n/a";
    console.log(
      `[EVB][avatar] job failed jobId=${input.jobId} code=${code} step=${step} outMp4=${outMp4} reason=${reason}`
    );
  }
}

function startQueue() {
  if (queueRunning) return;
  queueRunning = true;

  const loop = async () => {
    while (jobQueue.length > 0) {
      const input = jobQueue.shift();
      if (!input) continue;
      await runQueuedJob(input);
    }
    queueRunning = false;
  };

  loop().catch(() => {
    queueRunning = false;
  });
}

async function simulatePrepare({ preparedDir }) {
  const marker = path.join(preparedDir, "prepared.txt");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(marker, `prepared ${nowIso()}\n`, "utf8")
  );
}

async function runJob(input) {
  const key = jobKey(input.jobId, input.clipId);
  const record = jobs.get(key);
  if (!record) return;

  try {
    await ensureDirs();
  } catch (err) {
    const detail = toErrorDetail(err, "Failed to create local avatar work/cache directories.");
    const wrapped = new Error(detail);
    wrapped.code = "server_misconfigured";
    throw wrapped;
  }

  record.status = "running";
  record.updatedAt = nowIso();

  const force =
    input.preparationHint === "force" ||
    input.preparationHint === "force_prepare";

  const defaultFps = IMPL === "musetalk" ? 25 : 30;
  const fps = Number.isFinite(input.fps) ? input.fps : defaultFps;
  const bboxShift = Number.isFinite(input.bboxShift) ? input.bboxShift : 0;

  const audioBase64 = input.audioWavBase64 ?? input.audioBase64;

  const rawAvatarId = input.avatarId?.trim() ?? "";
  const needsSignature = !rawAvatarId || rawAvatarId === "default";
  const signature = needsSignature
    ? hashInputSignature({
        imagePngBase64: input.imagePngBase64,
        audioBase64,
        sourceVideoPath: input.sourceVideoPath
      })
    : null;
  const avatarIdForKey = needsSignature ? `default-${signature}` : rawAvatarId;
  const prepKey =
    record.prepKey ??
    `${buildPrepKey({
      avatarId: avatarIdForKey,
      imagePngBase64: input.imagePngBase64,
      fps,
      bboxShift
    })}:${PREP_CACHE_VERSION}`;

  record.prepKey = prepKey;

  const existedBefore = cache.has(prepKey);
  record.cacheHit = existedBefore && !force;

  const baseMeta = {
    prepKey,
    fps,
    bboxShift,
    avatarId: input.avatarId
  };

  if (IMPL === "musetalk") {
    const existingEntry = cache.getEntry(prepKey);
    const preparedDir = existingEntry?.preparedDir;
    const cacheDecision = buildCacheDecision({
      hit: record.cacheHit,
      dir: preparedDir,
      action: "fresh"
    });

    if (force) {
      cacheDecision.action = "force_regen";
      record.cacheHit = false;
      cache.entries.delete(prepKey);
      if (preparedDir) {
        try {
          await fs.promises.rm(preparedDir, { recursive: true, force: true });
        } catch {}
      }
    }

    const prevRecord = findLatestRecordByPrepKey(prepKey, record);
    if (!force && prevRecord && prevRecord.status !== "succeeded") {
      cacheDecision.action = "purge_and_regen";
      cacheDecision.reason = "previous_failed_or_invalid";
      cacheDecision.prevStatus = prevRecord.status;
      cacheDecision.prevErrorCode = prevRecord.errorCode ?? null;
      record.cacheHit = false;
      cache.entries.delete(prepKey);
      if (preparedDir) {
        try {
          await fs.promises.rm(preparedDir, { recursive: true, force: true });
        } catch {}
      }
    }

    if (record.cacheHit && preparedDir) {
      try {
        const imageBuffer = Buffer.from(input.imagePngBase64, "base64");
        const avatarKey = buildAvatarKey({ avatarId: input.avatarId, imageBuffer });
        const versionDir = MUSETALK_VERSION === "v15" ? "v15" : null;
        const baseResults = versionDir
          ? path.join(MUSETALK_REPO_DIR, "results", versionDir)
          : path.join(MUSETALK_REPO_DIR, "results");
        const outputPath = path.join(baseResults, "avatars", avatarKey, "vid_output", "clip0.mp4");
        const diagnostics = await computeMp4Diagnostics(outputPath, path.dirname(outputPath), []);
        if (!isPreviewCacheValid(diagnostics)) {
          cacheDecision.action = "purge_and_regen";
          cacheDecision.reason = "cache_preview_invalid";
          record.cacheHit = false;
          cache.entries.delete(prepKey);
          try {
            await fs.promises.rm(preparedDir, { recursive: true, force: true });
          } catch {}
          try {
            await fs.promises.rm(outputPath, { force: true });
          } catch {}
        } else {
          cacheDecision.action = "cache_hit";
        }
      } catch {
        cacheDecision.action = "purge_and_regen";
        cacheDecision.reason = "cache_validate_failed";
        record.cacheHit = false;
        cache.entries.delete(prepKey);
        try {
          await fs.promises.rm(preparedDir, { recursive: true, force: true });
        } catch {}
      }
    }
    record.meta.cacheDecision = cacheDecision;

    let result;
    try {
      result = await runMuseTalkClip({
        repoDir: MUSETALK_REPO_DIR,
        pythonBin: MUSETALK_PYTHON,
        version: MUSETALK_VERSION,
        modelsDir: MUSETALK_MODELS_DIR,
        ffmpegPath: MUSETALK_FFMPEG_PATH,
        avatarId: input.avatarId,
        imagePngBase64: input.imagePngBase64,
        audioWavBase64: audioBase64,
        fps,
        bboxShift,
        preparationHint: force ? "force" : input.preparationHint,
        timeoutMs: MUSETALK_TIMEOUT_MS,
        workRoot: WORK_ROOT,
        preparedDir,
        sourceVideoPath: input.sourceVideoPath
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!force && record.cacheHit && message.startsWith("preview_mp4_invalid")) {
        if (existingEntry?.preparedDir) {
          try {
            await fs.promises.rm(existingEntry.preparedDir, { recursive: true, force: true });
          } catch {}
        }
        cache.entries.delete(prepKey);
        record.cacheHit = false;
        record.meta.cacheDecision = buildCacheDecision({
          hit: false,
          dir: existingEntry?.preparedDir,
          action: "purge_and_regen"
        });
        result = await runMuseTalkClip({
          repoDir: MUSETALK_REPO_DIR,
          pythonBin: MUSETALK_PYTHON,
          version: MUSETALK_VERSION,
          modelsDir: MUSETALK_MODELS_DIR,
          ffmpegPath: MUSETALK_FFMPEG_PATH,
          avatarId: input.avatarId,
          imagePngBase64: input.imagePngBase64,
          audioWavBase64: audioBase64,
          fps,
          bboxShift,
          preparationHint: "force",
          timeoutMs: MUSETALK_TIMEOUT_MS,
          workRoot: WORK_ROOT,
          preparedDir: undefined,
          sourceVideoPath: input.sourceVideoPath
        });
      } else {
        throw err;
      }
    }

    cache.recordEntry({
      key: prepKey,
      preparedDir: result.preparedDir,
      fps,
      bboxShift
    });

    record.meta = { ...baseMeta, cacheHit: record.cacheHit };
    record.meta.input = input;
    record.status = "succeeded";
    record.updatedAt = nowIso();
    record.artifacts = {
      mp4Base64: result.mp4Buffer.toString("base64"),
      durationMs: result.durationMs ?? 1200
    };
    record.meta.mp4Path = result.mp4Path;
    record.meta.workDir = result.workDir;
    return;
  }

  const { entry } = await cache.getOrPrepare({
    key: prepKey,
    fps,
    bboxShift,
    force,
    prepareFn: simulatePrepare
  });

  record.meta = { ...baseMeta, cacheHit: record.cacheHit };
  record.status = "succeeded";
  record.updatedAt = nowIso();
  record.meta.mp4Path = await ensureStubPreviewFile(prepKey);
  record.artifacts = {
    mp4Base64: SAMPLE_MP4_BASE64,
    durationMs: 1200,
    preparedDir: entry.preparedDir
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      return respondJson(res, 200, {});
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return respondJson(res, 200, {
        ok: true,
        name: "musetalk",
        version: "local",
        engineBuildId: ENGINE_BUILD_ID
      });
    }

    if (req.method === "GET" && url.pathname === "/health/musetalk") {
      const pythonBin =
        runtimeEnv.EVB_PYTHON_BIN || runtimeEnv.EVB_MUSETALK_PYTHON || MUSETALK_PYTHON || "";
      const pythonExists = isPathLike(pythonBin) ? fs.existsSync(pythonBin) : null;
      const repoDir = runtimeEnv.EVB_MUSETALK_REPO_DIR || MUSETALK_REPO_DIR || null;
      const modelsDir = runtimeEnv.EVB_MUSETALK_MODELS_DIR || MUSETALK_MODELS_DIR || null;
      const ffmpegPath = runtimeEnv.EVB_FFMPEG_PATH || runtimeEnv.EVB_MUSETALK_FFMPEG_PATH || null;
      const repoExists = Boolean(repoDir && fs.existsSync(repoDir));
      const modelsExists = Boolean(modelsDir && fs.existsSync(modelsDir));
      const unetPath = modelsDir ? path.join(modelsDir, "musetalkV15", "unet.pth") : null;
      const unetExists = Boolean(unetPath && fs.existsSync(unetPath));
      const ffmpegPathExists = Boolean(ffmpegPath && fs.existsSync(ffmpegPath));
      let ffmpegOnPath = false;

      if (!ffmpegPathExists) {
        const ffmpegRes = await runCmdCaptureText("ffmpeg", ["-version"], 4000);
        ffmpegOnPath = ffmpegRes.ok;
      }

      return respondJson(res, 200, {
        ok: repoExists && modelsExists && unetExists && (ffmpegPathExists || ffmpegOnPath),
        pythonBin,
        pythonExists,
        musetalkRepoDir: repoDir,
        musetalkRepoExists: repoExists,
        musetalkModelsDir: modelsDir,
        musetalkModelsDirExists: modelsExists,
        unetPath,
        unetExists,
        ffmpegPath,
        ffmpegPathExists,
        ffmpegOnPath
      });
    }

    if (req.method === "GET" && url.pathname === "/health/details") {
      const details = await getDoctorHealth({ cache, envBase: runtimeEnv });
      return respondJson(res, 200, details);
    }

    if (req.method === "GET" && url.pathname === "/health/local-avatar") {
      const selfTest = await runSelfTest();
      const details = await getDoctorHealth({ cache, envBase: runtimeEnv });
      const actionItems = selfTest.ok ? [] : details.actionItems ?? [];
      const selfTestPayload = selfTest.ok
        ? { ok: true, versions: selfTest.versions ?? {} }
        : selfTest;

      return respondJson(res, 200, {
        ...details,
        ok: selfTest.ok,
        actionItems,
        versions: selfTest.ok ? selfTest.versions : undefined,
        selfTest: selfTestPayload,
        error: selfTest.ok ? undefined : selfTest.error,
        detail: selfTest.ok ? undefined : selfTest.detail,
        hint: selfTest.ok ? undefined : selfTest.hint,
        engineBuildId: ENGINE_BUILD_ID
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/local-avatar/health") {
      const readiness = await runReadinessChecks();
      return respondJson(res, 200, {
        ready: readiness.ready,
        checks: readiness.checks,
        reasons: readiness.reasons,
        suggestedFix: readiness.suggestedFix,
        detected: readiness.detected,
        engineBuildId: ENGINE_BUILD_ID
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/jobs") {
      const contentType = String(req.headers["content-type"] ?? "");
      const isMultipart = contentType.startsWith("multipart/form-data");
      const contentLength = Number(req.headers["content-length"] ?? 0);
      if (!isMultipart && Number.isFinite(MAX_JSON_BYTES) && contentLength > MAX_JSON_BYTES) {
        return respondJson(res, 413, {
          error: "payload_too_large",
          message: `Request body exceeds ${MAX_JSON_BYTES} bytes.`,
          detail: `Body exceeded ${MAX_JSON_BYTES} bytes based on Content-Length header.`
        });
      }

      if (!(await ensureDirsOrRespond(res))) {
        return;
      }

      let body;
      if (isMultipart) {
        const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
        if (!boundaryMatch) {
          return respondJson(res, 400, { error: "invalid_multipart" });
        }
        const raw = await readRawBody(req);
        const { fields, files } = parseMultipart(raw, boundaryMatch[1]);
        const sourceVideo = files.sourceVideo;
        let sourceVideoPath = null;
        if (sourceVideo?.buffer?.length) {
          const safeJobId = (fields.jobId ?? "job").replace(/[^a-z0-9_-]/gi, "_");
          const safeClipId = (fields.clipId ?? "clip0").replace(/[^a-z0-9_-]/gi, "_");
          const dir = path.join(WORK_ROOT, "uploads", `${safeJobId}_${safeClipId}_${Date.now()}`);
          await fs.promises.mkdir(dir, { recursive: true });
          const ext = path.extname(sourceVideo.filename || ".mp4") || ".mp4";
          sourceVideoPath = path.join(dir, `source${ext}`);
          await fs.promises.writeFile(sourceVideoPath, sourceVideo.buffer);
        }
        body = {
          jobId: fields.jobId,
          clipId: fields.clipId,
          avatarId: fields.avatarId,
          imagePngBase64: fields.imagePngBase64,
          audioBase64: fields.audioBase64,
          audioMime: fields.audioMime,
          fps: fields.fps ? Number(fields.fps) : undefined,
          bboxShift: fields.bboxShift ? Number(fields.bboxShift) : undefined,
          preparationHint: fields.preparationHint,
          sourceVideoPath
        };
      } else {
        try {
          body = await readJson(req);
        } catch (err) {
          if (err instanceof Error && err.message === "payload_too_large") {
            return respondJson(res, 413, {
              error: "payload_too_large",
              message: `Request body exceeds ${MAX_JSON_BYTES} bytes.`,
              detail: `Received payload exceeded ${MAX_JSON_BYTES} bytes while reading body.`
            });
          }
          if (err instanceof Error && err.message === "invalid_json") {
            return respondJson(res, 400, {
              error: "invalid_json",
              detail: "Request body is not valid JSON."
            });
          }
          throw err;
        }
      }

      if (!body || !body.jobId || !body.clipId || !body.imagePngBase64) {
        return respondJson(res, 400, buildInvalidRequestPayload(body, contentType));
      }

      const force =
        body.preparationHint === "force" || body.preparationHint === "force_prepare";

      const defaultFps = IMPL === "musetalk" ? 25 : 30;
      const fps = Number.isFinite(body.fps) ? body.fps : defaultFps;
      const bboxShift = Number.isFinite(body.bboxShift) ? body.bboxShift : 0;

      const rawAvatarId = body.avatarId?.trim() ?? "";
      const needsSignature = !rawAvatarId || rawAvatarId === "default";
      const signature = needsSignature
        ? hashInputSignature({
            imagePngBase64: body.imagePngBase64,
            audioBase64: body.audioBase64,
            sourceVideoPath: body.sourceVideoPath
          })
        : null;
      const avatarIdForKey = needsSignature ? `default-${signature}` : rawAvatarId;
      const prepKey = `${buildPrepKey({
        avatarId: avatarIdForKey,
        imagePngBase64: body.imagePngBase64,
        fps,
        bboxShift
      })}:${PREP_CACHE_VERSION}`;

      const cacheHit = cache.has(prepKey) && !force;

      const record = {
        status: "queued",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        artifacts: null,
        meta: {},
        prepKey,
        cacheHit
      };

      if (IMPL === "musetalk") {
        const reasons = [];
        const check = validateMuseTalkEnv();
        if (!check.ok) {
          reasons.push(`missing_env: ${check.missing.join(", ")}`);
        }
        const selfTest = await runSelfTest();
        if (!selfTest.ok) {
          if (selfTest.error) reasons.push(selfTest.error);
          if (selfTest.detail) reasons.push(selfTest.detail);
          if (selfTest.hint) reasons.push(selfTest.hint);
        }
        if (reasons.length > 0) {
          const errorDetail = ensureDetailSummary({
            code: "musetalk_not_ready",
            step: "self_test",
            reasons,
            trace: [],
            sniff: null,
            ffprobe: null,
            paths: { outMp4: null, workDir: null },
            producerFail: null
          });
          record.status = "failed";
          record.updatedAt = nowIso();
          record.error = "musetalk_not_ready";
          record.errorCode = "musetalk_not_ready";
          record.errorDetail = errorDetail;
          jobs.set(jobKey(body.jobId, body.clipId), record);
          return respondJson(res, 200, { accepted: true, prepKey, cacheHit });
        }
      }

      jobs.set(jobKey(body.jobId, body.clipId), record);
      jobQueue.push(body);
      startQueue();

      return respondJson(res, 200, { accepted: true, prepKey, cacheHit });
    }

    const statusMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/([^/]+)\/status$/);
    if (req.method === "GET" && statusMatch) {
      const [, jobId, clipId] = statusMatch;
      const record = jobs.get(jobKey(jobId, clipId));
      if (!record) return respondJson(res, 404, { status: "failed", error: "not_found" });

      const cacheHit = record.cacheHit ?? record.meta?.cacheHit ?? false;
      const prepKey = record.prepKey ?? record.meta?.prepKey ?? null;

      if (record.status === "failed") {
        if (record.meta?.cacheDecision?.action) {
          res.setHeader("X-EVB-Cache-Decision", record.meta.cacheDecision.action);
        }
        if (record.errorCode === "preview_mp4_invalid") {
          if (record.cacheHit && IMPL === "musetalk") {
            const selfTest = await runSelfTest();
            if (!selfTest.ok) {
              const reasons = [];
              if (selfTest.error) reasons.push(selfTest.error);
              if (selfTest.detail) reasons.push(selfTest.detail);
              if (selfTest.hint) reasons.push(selfTest.hint);
              const detail = ensureDetailSummary({
                code: "musetalk_not_ready",
                step: "self_test",
                reasons,
                trace: [],
                sniff: null,
                ffprobe: null,
                paths: { outMp4: null, workDir: record.meta?.workDir ?? null }
              });
              record.error = "musetalk_not_ready";
              record.errorCode = "musetalk_not_ready";
              record.errorDetail = detail;
            }
          }
          let detail = record.errorDetail ?? null;
          if (!isPreviewDetailComplete(detail)) {
            const outMp4Path = detail?.paths?.outMp4 ?? "";
            if (typeof outMp4Path === "string" && outMp4Path.endsWith(".tmp.mp4")) {
              detail = attachCacheDetail(
                ensureDetailSummary(normalizeDetailFromTrace(detail)),
                record
              );
              record.errorDetail = detail;
              record.updatedAt = nowIso();
            } else {
            const mp4Path = detail?.paths?.outMp4 ?? record.meta?.mp4Path ?? null;
            const workDir = detail?.paths?.workDir ?? record.meta?.workDir ?? null;
            if (mp4Path) {
              const diagnostics = await buildPreviewInvalidDetail({
                mp4Path,
                workDir,
                trace: detail?.trace,
                step: detail?.step ?? "validate_mp4"
              });
              detail = mergePreviewDetail(detail, diagnostics);
            } else {
              detail = mergePreviewDetail(detail, buildMissingPreviewDetail({ workDir }));
            }
            detail = attachCacheDetail(
              ensureDetailSummary(normalizeDetailFromTrace(detail)),
              record
            );
            record.errorDetail = detail;
            record.updatedAt = nowIso();
            }
          }
        } else {
          record.errorDetail = attachCacheDetail(
            ensureDetailSummary(normalizeDetailFromTrace(record.errorDetail)),
            record
          );
        }
          return respondJson(res, 200, {
            status: "failed",
            error: record.error,
            errorCode: record.errorCode ?? "unknown_error",
            errorDetail: record.errorDetail ?? undefined,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          cacheHit,
          prepKey
        });
      }

      return respondJson(res, 200, {
        status: record.status,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        cacheHit,
        prepKey
      });
    }

    const mp4Match = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/([^/]+)\/artifacts\.mp4$/);
    if ((req.method === "GET" || req.method === "HEAD") && mp4Match) {
      const [, jobId, clipId] = mp4Match;
      const record = jobs.get(jobKey(jobId, clipId));
      if (!record) {
        return respondJson(res, 404, { error: "not_ready" });
      }
      if (record.status === "failed") {
        if (record.meta?.cacheDecision?.action) {
          res.setHeader("X-EVB-Cache-Decision", record.meta.cacheDecision.action);
        }
        if (record.errorCode === "preview_mp4_invalid") {
          if (record.cacheHit && IMPL === "musetalk") {
            const selfTest = await runSelfTest();
            if (!selfTest.ok) {
              const reasons = [];
              if (selfTest.error) reasons.push(selfTest.error);
              if (selfTest.detail) reasons.push(selfTest.detail);
              if (selfTest.hint) reasons.push(selfTest.hint);
              const detail = ensureDetailSummary({
                code: "musetalk_not_ready",
                step: "self_test",
                reasons,
                trace: [],
                sniff: null,
                ffprobe: null,
                paths: { outMp4: null, workDir: record.meta?.workDir ?? null }
              });
              record.error = "musetalk_not_ready";
              record.errorCode = "musetalk_not_ready";
              record.errorDetail = detail;
            }
          }
          let detail = record.errorDetail ?? null;
          if (!isPreviewDetailComplete(detail)) {
            const outMp4Path = detail?.paths?.outMp4 ?? "";
            if (typeof outMp4Path === "string" && outMp4Path.endsWith(".tmp.mp4")) {
              detail = attachCacheDetail(
                ensureDetailSummary(normalizeDetailFromTrace(detail)),
                record
              );
              record.errorDetail = detail;
              record.updatedAt = nowIso();
            } else {
            const mp4Path = detail?.paths?.outMp4 ?? record.meta?.mp4Path ?? null;
            const workDir = detail?.paths?.workDir ?? record.meta?.workDir ?? null;
            if (mp4Path) {
              const diagnostics = await buildPreviewInvalidDetail({
                mp4Path,
                workDir,
                trace: detail?.trace,
                step: detail?.step ?? "validate_mp4"
              });
              detail = mergePreviewDetail(detail, diagnostics);
            } else {
              detail = mergePreviewDetail(detail, buildMissingPreviewDetail({ workDir }));
            }
            detail = attachCacheDetail(
              ensureDetailSummary(normalizeDetailFromTrace(detail)),
              record
            );
            record.errorDetail = detail;
            record.updatedAt = nowIso();
            }
          }
          res.setHeader("X-EVB-Engine-Build", ENGINE_BUILD_ID);
          return respondJson(res, 409, {
            error: "preview_invalid",
            reason: record.error,
            detail,
            engineBuildId: ENGINE_BUILD_ID
          });
        }

        record.errorDetail = attachCacheDetail(
          ensureDetailSummary(normalizeDetailFromTrace(record.errorDetail)),
          record
        );
        res.setHeader("X-EVB-Engine-Build", ENGINE_BUILD_ID);
        return respondJson(res, 409, {
          error: "preview_invalid",
          reason: record.error,
          detail: record.errorDetail,
          engineBuildId: ENGINE_BUILD_ID
        });
      }
      if (record.status !== "succeeded") {
        return respondJson(res, 404, { error: "not_ready" });
      }
      const mp4Path = record.meta?.mp4Path;
      if (!mp4Path) {
        let detail = await buildPreviewInvalidDetail({
          mp4Path: "",
          workDir: record.meta?.workDir ?? null,
          trace: null,
          step: "validate_missing"
        });
        detail = normalizeDetailFromTrace(detail);
        record.status = "failed";
        record.updatedAt = nowIso();
        record.error = "preview_mp4_invalid: missing";
        record.errorCode = "preview_mp4_invalid";
        record.errorDetail = attachCacheDetail(detail, record);
        res.setHeader("X-EVB-Engine-Build", ENGINE_BUILD_ID);
        return respondJson(res, 409, {
          error: "preview_invalid",
          reason: record.error,
          detail: record.errorDetail,
          engineBuildId: ENGINE_BUILD_ID
        });
      }

      const workDir = record.meta?.workDir ?? null;
      const detail = await buildPreviewInvalidDetail({
        mp4Path,
        workDir,
        trace: null,
        step: "validate_mp4"
      });
      if (!isMp4DiagnosticValid(detail)) {
        const normalizedDetail = normalizeDetailFromTrace(detail);
        record.status = "failed";
        record.updatedAt = nowIso();
        record.error = `preview_mp4_invalid: size=${normalizedDetail.sizeBytes ?? 0}`;
        record.errorCode = "preview_mp4_invalid";
        record.errorDetail = attachCacheDetail(normalizedDetail, record);
        res.setHeader("X-EVB-Engine-Build", ENGINE_BUILD_ID);
        return respondJson(res, 409, {
          error: "preview_invalid",
          reason: record.error,
          detail: record.errorDetail,
          engineBuildId: ENGINE_BUILD_ID
        });
      }

      setCorsHeaders(res);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-store");

      const rangeHeader = req.headers["range"];
      const range =
        typeof rangeHeader === "string"
          ? parseRangeHeader(rangeHeader, stat.size)
          : null;
      if (range) {
        res.statusCode = 206;
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${stat.size}`
        );
        res.setHeader("Content-Length", String(range.chunkSize));
        if (req.method === "HEAD") {
          return res.end();
        }
        return fs
          .createReadStream(mp4Path, { start: range.start, end: range.end })
          .pipe(res);
      }

      res.statusCode = 200;
      res.setHeader("Content-Length", String(stat.size));
      if (req.method === "HEAD") {
        return res.end();
      }
      return fs.createReadStream(mp4Path).pipe(res);
    }

    const artifactsMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/([^/]+)\/artifacts$/);
    if (req.method === "GET" && artifactsMatch) {
      const [, jobId, clipId] = artifactsMatch;
      const record = jobs.get(jobKey(jobId, clipId));
      if (!record || record.status !== "succeeded") {
        return respondJson(res, 404, { error: "not_ready" });
      }

      const cacheHit = record.cacheHit ?? record.meta?.cacheHit ?? false;
      const prepKey = record.prepKey ?? record.meta?.prepKey ?? null;

      return respondJson(res, 200, {
        ...record.artifacts,
        cacheHit,
        prepKey
      });
    }

    res.statusCode = 404;
    res.end("not found");
  } catch (err) {
    respondJson(res, 500, { error: "server_error", message: String(err) });
  }
});

if (process.env.EVB_LOCAL_AVATAR_DISABLE_LISTEN !== "1") {
  ensureDirs()
    .then(() => {
      server.listen(PORT, "0.0.0.0", () => {
        console.log(`[local-avatar] listening on ${PORT}`);
      });
    })
    .catch((err) => {
      const detail = toErrorDetail(err, "Failed to initialize local avatar directories.");
      console.error(`[local-avatar] startup failed: ${detail}`);
      process.exit(1);
    });
}
