import { Router } from "express";
import {
  ApprovedManifest,
  CreateJobRequest,
  CreateJobResponse,
  CleanupMode,
  StubAvatarStyle,
  StubBackgroundStyle,
  LocalAvatarAdvancedSettings,
  RetryJobResponse
} from "@evb/shared";
import { enqueueJob } from "../queue/jobQueue";
import { getJobStore } from "../store/jobStore";
import { createArtifactToken, validateArtifactToken } from "../lib/artifactTokens";
import { getArtifactFilePaths } from "../lib/stubArtifacts";
import { getAvatarProviderFromEnv } from "../providers/providerFactory";
import { getRunMode, getInstanceId, getQueueBackend, getStoreBackend, isRedisEnabled } from "../lib/config";
import { appendJobEvent } from "../lib/jobEvents";
import { promises as fs } from "node:fs";
import path from "node:path";

const JSZip = require("jszip");

function ensureArtifacts(jobId: string) {
  const mp4Rel = `${jobId}/video.mp4`;
  const vttRel = `${jobId}/captions.vtt`;
  const srtRel = `${jobId}/captions.srt`;
  const manifestRel = `${jobId}/manifest.json`;
  const mp4Token = createArtifactToken(jobId, { path: mp4Rel });
  const vttToken = createArtifactToken(jobId, { path: vttRel });
  const srtToken = createArtifactToken(jobId, { path: srtRel });
  const manifestToken = createArtifactToken(jobId);
  return {
    mp4Path: `/v1/artifacts/${mp4Token.token}/${mp4Rel}`,
    vttPath: `/v1/artifacts/${vttToken.token}/${vttRel}`,
    srtPath: `/v1/artifacts/${srtToken.token}/${srtRel}`,
    manifestPath: `/v1/jobs/${jobId}/artifacts/manifest.json?token=${manifestToken.token}`,
    expiresAt: new Date(Math.max(mp4Token.exp, vttToken.exp, srtToken.exp) * 1000).toISOString()
  };
}

const router = Router();
const logHttp = process.env.EVB_LOG_HTTP === "1";

function logNotFound(path: string) {
  if (!logHttp) {
    return;
  }
  console.warn(`[cloud] http 404 not_found path=${path}`);
}

function isValidManifest(manifest: ApprovedManifest | undefined): manifest is ApprovedManifest {
  if (!manifest) {
    return false;
  }
  if (
    manifest.manifestVersion !== "0.1" ||
    !manifest.courseTitle ||
    !manifest.approvedAt ||
    !manifest.draftSignature ||
    !Array.isArray(manifest.sections)
  ) {
    return false;
  }
  if (manifest.settings && !isValidSettings(manifest.settings)) {
    return false;
  }
  return manifest.sections.every(
    (section) =>
      typeof section.id === "string" &&
      typeof section.title === "string" &&
      typeof section.script === "string"
  );
}

function isValidCleanupMode(mode: CleanupMode | undefined): mode is CleanupMode {
  return mode === "off" || mode === "deterministic" || mode === "llm";
}

function isValidStubAvatarStyle(
  value: StubAvatarStyle | undefined
): value is StubAvatarStyle {
  return (
    value === "silhouette" ||
    value === "illustration" ||
    value === "photo" ||
    value === "badge"
  );
}

function isValidStubBackgroundStyle(
  value: StubBackgroundStyle | undefined
): value is StubBackgroundStyle {
  return value === "neutral" || value === "gradient" || value === "classroom";
}

function isValidLocalAvatarAdvanced(
  value: LocalAvatarAdvancedSettings | undefined
): value is LocalAvatarAdvancedSettings {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as LocalAvatarAdvancedSettings;
  const avatarOk =
    record.avatarId === undefined ||
    (typeof record.avatarId === "string" && record.avatarId.trim().length > 0);
  const fpsOk =
    record.fps === undefined ||
    (typeof record.fps === "number" && Number.isFinite(record.fps) && record.fps > 0);
  const bboxOk =
    record.bboxShift === undefined ||
    (typeof record.bboxShift === "number" &&
      Number.isFinite(record.bboxShift) &&
      Number.isInteger(record.bboxShift));
  return avatarOk && fpsOk && bboxOk;
}


function isValidSettings(settings: CreateJobRequest["settings"] | undefined): boolean {
  if (!settings) {
    return false;
  }
  const variations = settings.variationsPerSection ?? 1;
  if (
    (settings.outputMode !== "avatar_only" && settings.outputMode !== "avatar_plus_slides") ||
    !settings.avatarPresetId ||
    !settings.voicePresetId ||
    !settings.stylePresetId ||
    typeof settings.sentencesPerClip !== "number" ||
    !Number.isInteger(variations) ||
    variations < 1 ||
    variations > 5
  ) {
    return false;
  }
  return true;
}

function normalizeSettings(settings: CreateJobRequest["settings"]) {
  return {
    ...settings,
    variationsPerSection: settings.variationsPerSection ?? 1
  };
}

const MAX_IMAGES = 25;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_SINGLE_BYTES = 5 * 1024 * 1024;
const TABLE_IMAGES_DIR = "table-images";

function getArtifactsRoot() {
  return process.env.ARTIFACTS_DIR
    ? path.resolve(process.env.ARTIFACTS_DIR)
    : path.resolve(process.cwd(), ".artifacts");
}

function getJobInputsRoot(jobId: string) {
  return path.resolve(process.cwd(), "data", "jobs", jobId, "inputs", TABLE_IMAGES_DIR);
}

function normalizeZipPath(value: string) {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("invalid_artifact_path");
  }
  return normalized;
}

function resolveArtifactPath(artifactsRoot: string, relPath: string) {
  const normalized = normalizeZipPath(relPath);
  const abs = path.resolve(artifactsRoot, normalized);
  const relative = path.relative(artifactsRoot, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("invalid_artifact_path");
  }
  return { abs, rel: normalized };
}

async function readManifestFile(jobId: string) {
  const manifestPath = path.resolve(getArtifactsRoot(), jobId, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  try {
    const body = JSON.parse(raw);
    return { raw, body };
  } catch {
    throw new Error("manifest_invalid");
  }
}

function decodeBase64(input: string) {
  try {
    return Buffer.from(input, "base64");
  } catch {
    return null;
  }
}

function sanitizeExtension(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext && ext.length <= 8) {
    return ext;
  }
  return "";
}

async function writeTableImages(jobId: string, input: CreateJobRequest) {
  if (!input.tableImages || input.tableImages.length === 0) {
    return undefined;
  }
  if (input.settings.outputMode !== "avatar_plus_slides") {
    throw new Error("table_images_not_allowed");
  }
  if (input.tableImages.length > MAX_IMAGES) {
    throw new Error("table_images_limit");
  }
  const sectionIds = new Set(input.manifest.sections.map((section) => section.id));
  let totalBytes = 0;
  const jobInputImages: Array<{
    id: string;
    sectionId: string;
    anchorText: string;
    relPath: string;
    mimeType: string;
  }> = [];
  const inputsDir = getJobInputsRoot(jobId);
  await fs.mkdir(inputsDir, { recursive: true });

  for (const image of input.tableImages) {
    if (
      !image.id ||
      !image.sectionId ||
      !image.fileName ||
      !image.mimeType ||
      !image.anchorText ||
      !image.base64
    ) {
      throw new Error("table_images_invalid");
    }
    if (!sectionIds.has(image.sectionId)) {
      throw new Error("table_images_invalid_section");
    }
    const buffer = decodeBase64(image.base64);
    if (!buffer) {
      throw new Error("table_images_invalid");
    }
    if (buffer.length > MAX_SINGLE_BYTES) {
      throw new Error("table_images_limit");
    }
    if (totalBytes + buffer.length > MAX_TOTAL_BYTES) {
      throw new Error("table_images_limit");
    }
    totalBytes += buffer.length;
    const ext = sanitizeExtension(image.fileName) || ".bin";
    const safeName = `${image.id}${ext}`;
    const relPath = path.join("data", "jobs", jobId, "inputs", TABLE_IMAGES_DIR, safeName);
    const absPath = path.join(process.cwd(), relPath);
    await fs.writeFile(absPath, buffer);
    jobInputImages.push({
      id: image.id,
      sectionId: image.sectionId,
      anchorText: image.anchorText,
      relPath,
      mimeType: image.mimeType
    });
  }

  return jobInputImages;
}

router.post("/", async (req, res) => {
  const {
    manifest,
    settings,
    projectId,
    tableImages,
    targetSectionIds,
    scriptCleanupMode,
    cleanupConfigOverrides,
    stubAvatarStyle,
    stubBackgroundStyle,
    localAvatarAdvanced
  } = req.body as CreateJobRequest;
  if (!projectId || !isValidSettings(settings)) {
    return res.status(400).json({ error: "invalid_request" });
  }
  if (localAvatarAdvanced !== undefined && !isValidLocalAvatarAdvanced(localAvatarAdvanced)) {
    return res.status(400).json({ error: "invalid_request" });
  }
  if (!isValidManifest(manifest)) {
    return res.status(400).json({
      error: "approval_required",
      message: "Project must be approved before generation."
    });
  }
  const resolvedCleanupMode = isValidCleanupMode(scriptCleanupMode)
    ? scriptCleanupMode
    : manifest.cleanupMode ?? "off";
  const resolvedTargets = Array.isArray(targetSectionIds)
    ? targetSectionIds.filter((id) => typeof id === "string" && id.trim().length > 0)
    : undefined;
  if (resolvedTargets && resolvedTargets.length > 0) {
    const sectionIds = new Set(manifest.sections.map((section) => section.id));
    const invalidTargets = resolvedTargets.filter((id) => !sectionIds.has(id));
    if (invalidTargets.length > 0) {
      return res.status(400).json({ error: "invalid_request" });
    }
  }
  const resolvedManifest = manifest;
  if (resolvedCleanupMode && resolvedManifest.cleanupMode !== resolvedCleanupMode) {
    resolvedManifest.cleanupMode = resolvedCleanupMode;
  }
  const resolvedStubAvatarStyle = isValidStubAvatarStyle(stubAvatarStyle)
    ? stubAvatarStyle
    : "silhouette";
  const resolvedStubBackgroundStyle = isValidStubBackgroundStyle(stubBackgroundStyle)
    ? stubBackgroundStyle
    : "neutral";
  const resolvedLocalAvatarAdvanced = isValidLocalAvatarAdvanced(localAvatarAdvanced)
    ? localAvatarAdvanced
    : undefined;

  try {
      const input = {
        projectId,
        manifest: resolvedManifest,
        settings: normalizeSettings(settings),
        tableImages,
        targetSectionIds: resolvedTargets,
        scriptCleanupMode: resolvedCleanupMode,
        cleanupConfigOverrides,
        stubAvatarStyle: resolvedStubAvatarStyle,
        stubBackgroundStyle: resolvedStubBackgroundStyle,
        localAvatarAdvanced: resolvedLocalAvatarAdvanced
      };
    const jobStore = getJobStore();
    const job = await jobStore.createJob({
      manifest: resolvedManifest,
      projectId,
      settings: normalizeSettings(settings),
      targetSectionIds: resolvedTargets,
      scriptCleanupMode: resolvedCleanupMode,
      cleanupConfigOverrides,
      stubAvatarStyle: resolvedStubAvatarStyle,
      stubBackgroundStyle: resolvedStubBackgroundStyle,
      localAvatarAdvanced: resolvedLocalAvatarAdvanced
    });
    const mode = getRunMode();
    const storeBackend = getStoreBackend();
    const queueBackend = getQueueBackend();
    const provider = getAvatarProviderFromEnv(process.env, mode);
    console.log(`[EVB] job accepted jobId=${job.id} mode=${mode} provider=${provider.name}`);
    if (isRedisEnabled()) {
      try {
        const { getRedis } = await import("../redis/client");
        await appendJobEvent(getRedis(), getInstanceId(), job.id, "accepted", {
          mode,
          provider: provider.name,
          store: storeBackend,
          queue: queueBackend
        });
      } catch {
        // ignore event failures
      }
    }
    const storedImages = await writeTableImages(job.id, input);
    if (storedImages) {
      await jobStore.updateJob(job.id, { inputTableImages: storedImages });
    }
    await enqueueJob(job.id);
    if (isRedisEnabled()) {
      try {
        const { getRedis } = await import("../redis/client");
        await appendJobEvent(getRedis(), getInstanceId(), job.id, "queued", {
          queueBackend: getQueueBackend()
        });
      } catch {
        // ignore event failures
      }
    }
    const response: CreateJobResponse = { jobId: job.id, status: job };
    return res.status(201).json(response);
  } catch (err) {
    console.error("failed to enqueue job", err);
    const message = err instanceof Error ? err.message : String(err);
    if (message === "table_images_not_allowed") {
      return res
        .status(400)
        .json({
          error: "table_images_not_allowed",
          message: "Table images are only allowed in avatar_plus_slides mode."
        });
    }
    if (message === "table_images_limit") {
      return res.status(413).json({
        error: "table_images_limit",
        message:
          "Table images payload exceeds size limits. Reduce images or switch to avatar-only mode."
      });
    }
    if (message.startsWith("table_images_invalid")) {
      return res.status(400).json({
        error: "table_images_invalid",
        message: "Table images are invalid or missing."
      });
    }
    return res
      .status(503)
      .json({ error: "Redis unavailable", hint: "Run docker compose up -d" });
  }
});

router.get("/:id", async (req, res) => {
  const jobStore = getJobStore();
  const job = await jobStore.getJob(req.params.id);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  if (job.status === "succeeded") {
    return res.json({ ...job, artifacts: ensureArtifacts(job.id) });
  }
  return res.json(job);
});

router.post("/:id/retry", async (req, res) => {
  const jobStore = getJobStore();
  const job = await jobStore.getJob(req.params.id);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  if (job.status !== "failed") {
    return res.status(400).json({ error: "not_retryable" });
  }

  await jobStore.resetForRetry(job.id);
  await enqueueJob(job.id);
  const response: RetryJobResponse = { jobId: job.id };
  return res.json(response);
});

router.get("/:id/artifacts/video.mp4", async (req, res) => {
  const jobId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const validation = validateArtifactToken(token, jobId);
  if (!validation.ok) {
    if (validation.expired) {
      return res.status(410).json({ error: "token_expired", message: "Token expired" });
    }
    return res.status(403).json({ error: "invalid_token", message: "Invalid token" });
  }
  const jobStore = getJobStore();
  const job = await jobStore.getJob(jobId);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  if (job.status !== "succeeded") {
    return res.status(409).json({ error: "Artifacts not ready" });
  }
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(getArtifactFilePaths(jobId).mp4Abs);
  } catch {
    return res.status(404).json({ error: "artifact_missing" });
  }
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", "attachment; filename=\"video.mp4\"");
  return res.send(buffer);
});

router.get("/:id/artifacts/captions.vtt", async (req, res) => {
  const jobId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const validation = validateArtifactToken(token, jobId);
  if (!validation.ok) {
    if (validation.expired) {
      return res.status(410).json({ error: "token_expired", message: "Token expired" });
    }
    return res.status(403).json({ error: "invalid_token", message: "Invalid token" });
  }
  const jobStore = getJobStore();
  const job = await jobStore.getJob(jobId);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  if (job.status !== "succeeded") {
    return res.status(409).json({ error: "Artifacts not ready" });
  }
  let contents: string;
  try {
    contents = await fs.readFile(getArtifactFilePaths(jobId).vttAbs, "utf8");
  } catch {
    return res.status(404).json({ error: "artifact_missing" });
  }
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"captions.vtt\"");
  return res.send(contents);
});

router.get("/:id/artifacts/captions.srt", async (req, res) => {
  const jobId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const validation = validateArtifactToken(token, jobId);
  if (!validation.ok) {
    if (validation.expired) {
      return res.status(410).json({ error: "token_expired", message: "Token expired" });
    }
    return res.status(403).json({ error: "invalid_token", message: "Invalid token" });
  }
  const jobStore = getJobStore();
  const job = await jobStore.getJob(jobId);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  if (job.status !== "succeeded") {
    return res.status(409).json({ error: "Artifacts not ready" });
  }
  let contents: string;
  try {
    contents = await fs.readFile(getArtifactFilePaths(jobId).srtAbs, "utf8");
  } catch {
    return res.status(404).json({ error: "artifact_missing" });
  }
  res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"captions.srt\"");
  return res.send(contents);
});

router.get("/:id/artifacts/manifest.json", async (req, res) => {
  const jobId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const validation = validateArtifactToken(token, jobId);
  if (!validation.ok) {
    if (validation.expired) {
      return res.status(410).json({ error: "token_expired", message: "Token expired" });
    }
    return res.status(403).json({ error: "invalid_token", message: "Invalid token" });
  }
  const jobStore = getJobStore();
  const job = await jobStore.getJob(jobId);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  let body: any;
  try {
    body = (await readManifestFile(jobId)).body;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "manifest_invalid") {
      return res.status(500).json({ error: "manifest_invalid" });
    }
    return res.status(404).json({ error: "artifact_missing" });
  }
  const tokenForPath = (relPath: string) => {
    const artifactToken = createArtifactToken(jobId, { path: relPath });
    return `/v1/artifacts/${artifactToken.token}/${relPath}`;
  };
  if (body?.primary) {
    body.primary = {
      ...body.primary,
      mp4Path: tokenForPath(body.primary.mp4Path),
      vttPath: tokenForPath(body.primary.vttPath),
      srtPath: tokenForPath(body.primary.srtPath)
    };
  }
  if (Array.isArray(body?.sections)) {
    body.sections = body.sections.map((section: any) => ({
      ...section,
      variations: Array.isArray(section.variations)
        ? section.variations.map((variation: any) => ({
            ...variation,
            clips: Array.isArray(variation.clips)
              ? variation.clips.map((clip: any) => ({
                  ...clip,
                  mp4Path: tokenForPath(clip.mp4Path),
                  vttPath: tokenForPath(clip.vttPath),
                  srtPath: tokenForPath(clip.srtPath)
                }))
              : []
          }))
        : []
    }));
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.json(body);
});

router.post("/:id/export-selection", async (req, res) => {
  const jobId = req.params.id;
  const jobStore = getJobStore();
  const job = await jobStore.getJob(jobId);
  if (!job) {
    logNotFound(req.originalUrl);
    return res.status(404).json({ error: "not_found" });
  }
  if (job.status !== "succeeded") {
    return res.status(409).json({ error: "artifacts_not_ready" });
  }

  let manifest: any;
  try {
    manifest = (await readManifestFile(jobId)).body;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "manifest_invalid") {
      return res.status(500).json({ error: "manifest_invalid" });
    }
    return res.status(404).json({ error: "artifact_missing" });
  }

  const selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
  const selectionMap: Record<string, number> = {};
  for (const selection of selections) {
    if (!selection || typeof selection.sectionId !== "string") {
      continue;
    }
    const idx = Number(selection.variationIndex);
    if (Number.isInteger(idx) && idx >= 0) {
      selectionMap[selection.sectionId] = idx;
    }
  }

  const selectedClips: Array<{ mp4Path: string; vttPath: string; srtPath: string }> = [];
  if (Array.isArray(manifest?.sections)) {
    for (const section of manifest.sections) {
      const sectionId = section?.sectionId;
      if (typeof sectionId !== "string" || !Array.isArray(section.variations)) {
        continue;
      }
      const requested = selectionMap[sectionId] ?? 0;
      const variation =
        section.variations.find((item: any) => item.variationIndex === requested) ??
        section.variations[0];
      const chosenIndex =
        typeof variation?.variationIndex === "number" ? variation.variationIndex : requested;
      selectionMap[sectionId] = chosenIndex;
      if (!variation || !Array.isArray(variation.clips)) {
        continue;
      }
      for (const clip of variation.clips) {
        if (!clip?.mp4Path || !clip?.vttPath || !clip?.srtPath) {
          continue;
        }
        selectedClips.push({
          mp4Path: clip.mp4Path,
          vttPath: clip.vttPath,
          srtPath: clip.srtPath
        });
      }
    }
  }

  if (selectedClips.length === 0) {
    return res.status(404).json({ error: "selection_empty" });
  }

  const artifactsRoot = getArtifactsRoot();
  const zip = new JSZip();

  const addFile = async (relPath: string, zipPath?: string) => {
    const { abs, rel } = resolveArtifactPath(artifactsRoot, relPath);
    const buffer = await fs.readFile(abs);
    zip.file(zipPath ?? rel, buffer);
  };

  try {
    for (const clip of selectedClips) {
      await Promise.all([
        addFile(clip.mp4Path),
        addFile(clip.vttPath),
        addFile(clip.srtPath)
      ]);
    }
    const primaryClip = selectedClips[0];
    const primaryMp4Rel = path.posix.join(jobId, "primary.mp4");
    const primaryVttRel = path.posix.join(jobId, "primary.vtt");
    const primarySrtRel = path.posix.join(jobId, "primary.srt");
    const primaryMp4 = await fs.readFile(
      resolveArtifactPath(artifactsRoot, primaryClip.mp4Path).abs
    );
    const primaryVtt = await fs.readFile(
      resolveArtifactPath(artifactsRoot, primaryClip.vttPath).abs
    );
    const primarySrt = await fs.readFile(
      resolveArtifactPath(artifactsRoot, primaryClip.srtPath).abs
    );
    zip.file(primaryMp4Rel, primaryMp4);
    zip.file(primaryVttRel, primaryVtt);
    zip.file(primarySrtRel, primarySrt);
  } catch {
    return res.status(404).json({ error: "artifact_missing" });
  }

  const manifestForZip = {
    ...manifest,
    selectedVariations: selectionMap
  };
  zip.file("manifest.json", JSON.stringify(manifestForZip, null, 2));

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"export_${jobId.slice(0, 8)}.zip\"`
  );
  return res.send(buffer);
});

export { router as jobsRouter };
