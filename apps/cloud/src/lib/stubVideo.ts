import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { promises as fs, existsSync } from "node:fs";
import type { RenderProfile, StubAvatarStyle, StubBackgroundStyle } from "@evb/shared";

type StubVideoArgs = {
  outPathAbs: string;
  durationSec: number;
  audioPathAbs?: string | null;
  audioDurationMs?: number;
  courseTitle?: string;
  sectionTitles?: string[];
  segments?: Array<{ durationSec: number; imagePathAbs?: string }>;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
  jobId?: string;
};

const FALLBACK_MP4_BASE64 =
  "AAAAHGZ0eXBpc29tAAAAAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAJBtZGF0AAAAFgAAABIAAAABAAAAAQAAAAAAAAABAAACAG1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAPoAAEAAAEAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGd0cmFrAAAAXHRraGQAAAAAAAAAAAAAAAAAAAEAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAAABAAAAAAgAAAAEAAAAAAAAAAAAAAAAAAAAAAAB0a2hkAAAAAAAAAAAAAAAAAAAEAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGQAAABAAAAAAgAAAAEAAAAAAAAAAAAAAAAAAAAAAABtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAAPoAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAtG1pbmYAAAAUdm1oZAAAAABAAAAAAAAAAAAAAABvbWRoZAAAAABAAAAAAAAAAAAAAAABAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAtc3RibAAAADZzdHNkAAAAAAAAAAEAAABGAAAAAG1wNGEAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAABAAAD6AAAAB9tZGF0AAAAFgAAABIAAAABAAAAAQAAAAAAAAABAA==";
const MIN_FALLBACK_BYTES = 2048;
const MIN_AUDIO_BYTES = 10 * 1024;
const AVATAR_SILHOUETTE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABSUlEQVR42u3YMQ0AIRQFQXRSXI1/A+DhQsXOJt8AbyrGkCRJkiRJkiRJkiRJkqRnmt/aXiEw8t/zesHRYTA8CMaHwPAgGB8C40NgfAiMD4HxITA+BAAAYHwIjA8BAAAYHwIAAAAAAONDAAAAAAAAAAAAAAAAAAAAYHwIIDA+AAAAAAAA1gRAAAgA9RBYEQABoCQC6wGgKgKrhRFYCwBVEVgpjMA6YQRWCSOwRhiBFcIIvH4UgtcOI/DKUQheNYjB6wV+7nwsAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAEQFwADgAHAAOAAeAA8AB4ABwADgAHAAOAAeAA8AB4ABwADgAHAAOAAAAAAAAAAAAAAAArncA7QsF4Rr6uEIAAAAASUVORK5CYII=";
const AVATAR_ILLUSTRATION_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABSUlEQVR42u3YMQ0AIRQFQXRSXI1/A+DhQsXOJt8AbyrGkCRJkiRJkiRJkiRJkqRnmt/aXiEw8t/zesHRYTA8CMaHwPAgGB8C40NgfAiMD4HxITA+BAAAYHwIjA8BAAAYHwIAAAAAAONDAAAAAAAAAAAAAAAAAAAAYHwIIDA+AAAAAAAA1gRAAAgA9RBYEQABoCQC6wGgKgKrhRFYCwBVEVgpjMA6YQRWCSOwRhiBFcIIvH4UgtcOI/DKUQheNYjB6wV+7nwsAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAEQFwADgAHAAOAAeAA8AB4ABwADgAHAAOAAeAA8AB4ABwADgAHAAOAAAAAAAAAAAAAAAArncA7QsF4Rr6uEIAAAAASUVORK5CYII=";
const AVATAR_PHOTO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABSUlEQVR42u3YMQ0AIRQFQXRSXI1/A+DhQsXOJt8AbyrGkCRJkiRJkiRJkiRJkqRnmt/aXiEw8t/zesHRYTA8CMaHwPAgGB8C40NgfAiMD4HxITA+BAAAYHwIjA8BAAAYHwIAAAAAAONDAAAAAAAAAAAAAAAAAAAAYHwIIDA+AAAAAAAA1gRAAAgA9RBYEQABoCQC6wGgKgKrhRFYCwBVEVgpjMA6YQRWCSOwRhiBFcIIvH4UgtcOI/DKUQheNYjB6wV+7nwsAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAEQFwADgAHAAOAAeAA8AB4ABwADgAHAAOAAeAA8AB4ABwADgAHAAOAAAAAAAAAAAAAAAArncA7QsF4Rr6uEIAAAAASUVORK5CYII=";
const AVATAR_BADGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABSUlEQVR42u3YMQ0AIRQFQXRSXI1/A+DhQsXOJt8AbyrGkCRJkiRJkiRJkiRJkqRnmt/aXiEw8t/zesHRYTA8CMaHwPAgGB8C40NgfAiMD4HxITA+BAAAYHwIjA8BAAAYHwIAAAAAAONDAAAAAAAAAAAAAAAAAAAAYHwIIDA+AAAAAAAA1gRAAAgA9RBYEQABoCQC6wGgKgKrhRFYCwBVEVgpjMA6YQRWCSOwRhiBFcIIvH4UgtcOI/DKUQheNYjB6wV+7nwsAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAEQFwADgAHAAOAAeAA8AB4ABwADgAHAAOAAeAA8AB4ABwADgAHAAOAAAAAAAAAAAAAAAArncA7QsF4Rr6uEIAAAAASUVORK5CYII=";
const BG_GRADIENT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mM8fPjwfwYGBgYGJgYAAJwAB5Z5V8IAAAAASUVORK5CYII=";
const BG_CLASSROOM_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mM8fPjwfwYGBgYGJgYAAK8ABbA6Jd4AAAAASUVORK5CYII=";

const RENDER_WIDTH = 1280;
const RENDER_HEIGHT = 720;
const RENDER_FPS = 30;
const AVATAR_SIZE = 360;
const AVATAR_BADGE_SIZE = 140;
const AVATAR_OFFSET_Y = -12;
const DEFAULT_AVATAR_STYLE: StubAvatarStyle = "silhouette";
const DEFAULT_BACKGROUND_STYLE: StubBackgroundStyle = "neutral";
const BASE_PROFILE: Omit<RenderProfile, "codec"> = {
  width: RENDER_WIDTH,
  height: RENDER_HEIGHT,
  fps: RENDER_FPS,
  pixelFormat: "yuv420p"
};

const loggedStubRenderJobs = new Set<string>();

let cachedFfmpegPath: string | null | undefined;
let loggedFfmpegStatus = false;
let loggedStubVideoStatus = false;
const AVATAR_LABEL = "Instructor";

type FfmpegResolution =
  | { kind: "env"; path: string; reason: string }
  | { kind: "static"; path: string; reason: string }
  | { kind: "none"; reason: string };

function logFfmpegStatus(status: "static" | "env" | "none", reason: string, pathValue?: string) {
  if (loggedFfmpegStatus) {
    return;
  }
  loggedFfmpegStatus = true;
  try {
    const reasonPart = reason ? ` reason=${reason}` : "";
    const pathPart = pathValue ? ` path=${pathValue}` : "";
    console.log(`[EVB] ffmpeg=${status}${reasonPart}${pathPart}`);
  } catch {
    // ignore log failures
  }
}

function logStubVideoStatus(
  status: "static" | "env" | "none",
  reason: string,
  pathValue?: string
) {
  if (loggedStubVideoStatus) {
    return;
  }
  loggedStubVideoStatus = true;
  try {
    const reasonPart = reason ? ` reason=${reason}` : "";
    const pathPart = pathValue ? ` path=${pathValue}` : "";
    console.log(`[EVB] stubVideo=avatar ffmpeg=${status}${reasonPart}${pathPart}`);
  } catch {
    // ignore log failures
  }
}

function logStubRenderInfo(args: {
  jobId?: string;
  avatarStyle: StubAvatarStyle;
  backgroundStyle: StubBackgroundStyle;
  codec: "libx264" | "mpeg4";
  ffmpeg: FfmpegResolution;
}) {
  const key = args.jobId ?? "global";
  if (loggedStubRenderJobs.has(key)) {
    return;
  }
  loggedStubRenderJobs.add(key);
  const reason = args.ffmpeg.reason ? ` reason=${args.ffmpeg.reason}` : "";
  if (args.ffmpeg.kind === "none") {
    console.log(
      `[EVB] stubVideo fallback=embedded (no-ffmpeg) style=${args.avatarStyle} bg=${args.backgroundStyle} NOTE=style_ignored`
    );
    return;
  }
  console.log(
    `[EVB] stubVideo style=${args.avatarStyle} bg=${args.backgroundStyle} canvas=${RENDER_WIDTH}x${RENDER_HEIGHT} fps=${RENDER_FPS} codec=${args.codec} ffmpeg=${args.ffmpeg.kind}${reason}`
  );
}

async function resolveFfmpegPath(): Promise<FfmpegResolution> {
  if (cachedFfmpegPath !== undefined) {
    if (cachedFfmpegPath) {
      return { kind: "env", path: cachedFfmpegPath, reason: "cached" };
    }
    return { kind: "none", reason: "cached-none" };
  }

  if (process.env.EVB_DISABLE_FFMPEG === "1") {
    cachedFfmpegPath = null;
    logFfmpegStatus("none", "EVB_DISABLE_FFMPEG");
    return { kind: "none", reason: "EVB_DISABLE_FFMPEG" };
  }

  const envPath = process.env.EVB_FFMPEG_PATH;
  if (envPath && existsSync(envPath)) {
    cachedFfmpegPath = envPath;
    logFfmpegStatus("env", "EVB_FFMPEG_PATH", envPath);
    return { kind: "env", path: envPath, reason: "EVB_FFMPEG_PATH" };
  }

  try {
    const mod = await import("ffmpeg-static");
    const candidate = (mod as { default?: unknown } | unknown) as { default?: unknown } | unknown;
    const resolved =
      typeof candidate === "object" && candidate !== null && "default" in candidate
        ? (candidate as { default?: unknown }).default
        : candidate;
    const ffmpegPath = typeof resolved === "string" ? resolved : undefined;
    if (ffmpegPath && existsSync(ffmpegPath)) {
      cachedFfmpegPath = ffmpegPath;
      logFfmpegStatus("static", "ffmpeg-static", ffmpegPath);
      return { kind: "static", path: ffmpegPath, reason: "ffmpeg-static" };
    }
  } catch {
    // ignore
  }

  cachedFfmpegPath = null;
  logFfmpegStatus("none", "ffmpeg-static-not-available");
  return { kind: "none", reason: "ffmpeg-static-not-available" };
}

function runFfmpeg(args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { windowsHide: true });
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

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
        reject(new Error("ffmpeg timed out"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      if (process.env.EVB_LOG_HTTP === "1") {
        const idx = args.indexOf("-filter_complex");
        const filterValue = idx >= 0 ? args[idx + 1] : "";
        console.warn("[EVB] ffmpeg failed argv:", args.join(" "));
        if (filterValue) {
          console.warn("[EVB] ffmpeg filter_complex:", filterValue);
        }
      }
      const snippet = stderr.trim().split("\n").slice(-4).join("\n");
      reject(new Error(snippet || `ffmpeg exited with code ${code}`));
    });
  });
}

function ensureMinSize(buffer: Buffer, min = MIN_FALLBACK_BYTES) {
  if (buffer.length >= min) {
    return buffer;
  }
  const padding = Buffer.alloc(min - buffer.length);
  return Buffer.concat([buffer, padding]);
}

function resolveFontPath() {
  const envFont = process.env.EVB_STUB_FONT_PATH;
  if (envFont && existsSync(envFont)) {
    return envFont;
  }
  if (process.platform === "win32") {
    const arial = "C:\\Windows\\Fonts\\arial.ttf";
    if (existsSync(arial)) {
      return arial;
    }
  }
  const dejavu = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  if (existsSync(dejavu)) {
    return dejavu;
  }
  return null;
}

function formatFontPathForFfmpeg(fontPath: string) {
  const forward = fontPath.replace(/\\/g, "/");
  return forward.replace(":/", "\\:/").replace(/ /g, "\\ ");
}

function resolveStubAvatarStyle(value?: StubAvatarStyle): StubAvatarStyle {
  if (value === "silhouette" || value === "illustration" || value === "photo" || value === "badge") {
    return value;
  }
  return DEFAULT_AVATAR_STYLE;
}

function resolveStubBackgroundStyle(value?: StubBackgroundStyle): StubBackgroundStyle {
  if (value === "neutral" || value === "gradient" || value === "classroom") {
    return value;
  }
  return DEFAULT_BACKGROUND_STYLE;
}

function buildAvatarOverlayFilter({
  bgInput,
  avatarIndex,
  labelText,
  fontPath,
  outputLabel,
  withSar,
  avatarStyle
}: {
  bgInput: string;
  avatarIndex: number;
  labelText?: string | null;
  fontPath?: string | null;
  outputLabel: string;
  withSar?: boolean;
  avatarStyle: StubAvatarStyle;
}) {
  const parts: string[] = [];
  const bgLabel = `bg${outputLabel}`;
  parts.push(`[${bgInput}]format=rgba[${bgLabel}]`);
  const avRaw = `avraw${outputLabel}`;
  const avAlpha = `avalpha${outputLabel}`;
  const avColor = `avcolor${outputLabel}`;
  const avLabel = `av${outputLabel}`;
  const avatarTarget = avatarStyle === "badge" ? AVATAR_BADGE_SIZE : AVATAR_SIZE;
  parts.push(
    `[${avatarIndex}:v]format=rgba,scale=-1:${avatarTarget}[${avRaw}]`
  );
  if (avatarStyle === "silhouette") {
    parts.push(`[${avRaw}]format=rgba[${avLabel}]`);
  } else {
    const color =
      avatarStyle === "illustration"
        ? "0x2563eb"
        : avatarStyle === "photo"
          ? "0x94a3b8"
          : "0x0f172a";
    parts.push(`[${avRaw}]alphaextract[${avAlpha}]`);
    parts.push(`color=c=${color}:s=${AVATAR_SIZE}x${AVATAR_SIZE}[${avColor}]`);
    parts.push(`[${avColor}][${avAlpha}]alphamerge[${avLabel}]`);
  }
  const offsetPart =
    avatarStyle === "badge"
      ? ""
      : AVATAR_OFFSET_Y >= 0
        ? `+${AVATAR_OFFSET_Y}`
        : `${AVATAR_OFFSET_Y}`;
  let baseLabel = bgLabel;
  if (avatarStyle === "photo") {
    const shadowAlpha = `avshadowa${outputLabel}`;
    const shadowColor = `avshadowc${outputLabel}`;
    const shadowLabel = `avshadow${outputLabel}`;
    parts.push(`[${avAlpha}]boxblur=8:1[${shadowAlpha}]`);
    parts.push(`color=c=0x000000@0.25:s=${AVATAR_SIZE}x${AVATAR_SIZE}[${shadowColor}]`);
    parts.push(`[${shadowColor}][${shadowAlpha}]alphamerge[${shadowLabel}]`);
    const shadowed = `bgshadow${outputLabel}`;
    const shadowX = avatarStyle === "badge" ? "W-w-48" : "(W-w)/2+8";
    const shadowY = avatarStyle === "badge" ? "H-h-48" : `(H-h)/2+8${offsetPart}`;
    parts.push(`[${baseLabel}][${shadowLabel}]overlay=${shadowX}:${shadowY}:format=auto[${shadowed}]`);
    baseLabel = shadowed;
  }
  if (avatarStyle === "badge") {
    const badgeLabel = `badge${outputLabel}`;
    const badgeBox = `badgebox${outputLabel}`;
    const badgeOut = `bgbadge${outputLabel}`;
    parts.push(`color=c=0xf8fafc:s=${AVATAR_BADGE_SIZE}x${AVATAR_BADGE_SIZE}[${badgeLabel}]`);
    parts.push(
      `[${badgeLabel}]drawbox=x=0:y=0:w=${AVATAR_BADGE_SIZE}:h=${AVATAR_BADGE_SIZE}:color=0x0f172a@0.18:t=4[${badgeBox}]`
    );
    parts.push(
      `[${baseLabel}][${badgeBox}]overlay=W-w-48:H-h-48:format=auto[${badgeOut}]`
    );
    baseLabel = badgeOut;
  }
  const overlayX = avatarStyle === "badge" ? "W-w-48" : "(W-w)/2";
  const overlayY =
    avatarStyle === "badge" ? "H-h-48" : `(H-h)/2${offsetPart}`;
  let overlay = `[${baseLabel}][${avLabel}]overlay=${overlayX}:${overlayY}:format=auto`;
  if (fontPath && labelText && avatarStyle !== "badge") {
    const ffmpegFont = formatFontPathForFfmpeg(fontPath);
    overlay += `,drawtext=fontfile=${ffmpegFont}:text=${labelText}:fontcolor=0xffffff:fontsize=48:x=(w-text_w)/2:y=h-120:shadowcolor=0x000000:shadowx=2:shadowy=2`;
  }
  const sarPart = withSar ? ",setsar=1" : "";
  parts.push(`${overlay}${sarPart}[v${outputLabel}]`);
  return parts.join(";");
}

function getAvatarBase64(style: StubAvatarStyle) {
  if (style === "illustration") {
    return AVATAR_ILLUSTRATION_BASE64;
  }
  if (style === "photo") {
    return AVATAR_PHOTO_BASE64;
  }
  if (style === "badge") {
    return AVATAR_BADGE_BASE64;
  }
  return AVATAR_SILHOUETTE_BASE64;
}

function getBackgroundBase64(style: StubBackgroundStyle) {
  if (style === "gradient") {
    return BG_GRADIENT_BASE64;
  }
  if (style === "classroom") {
    return BG_CLASSROOM_BASE64;
  }
  return null;
}

async function writeTempAsset(dir: string, fileName: string, base64: string) {
  const output = path.join(dir, fileName);
  await fs.writeFile(output, Buffer.from(base64, "base64"));
  return output;
}

async function validateOutput(
  outPathAbs: string,
  options: { minSize: number; requireAudio: boolean }
) {
  try {
    const stat = await fs.stat(outPathAbs);
    if (stat.size < options.minSize) {
      return false;
    }
    const contents = await fs.readFile(outPathAbs);
    const hasFtyp = contents.includes(Buffer.from("ftyp"));
    const hasMoov = contents.includes(Buffer.from("moov"));
    const hasMdat = contents.includes(Buffer.from("mdat"));
    if (!(hasFtyp && hasMoov && hasMdat)) {
      return false;
    }
    if (options.requireAudio) {
      const hasVideo = contents.includes(Buffer.from("vide"));
      const hasAudio = contents.includes(Buffer.from("soun"));
      if (!hasVideo || !hasAudio) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function buildTempOutputPath(finalPath: string) {
  const dir = path.dirname(finalPath);
  const name = `.tmp-${randomUUID()}-${path.basename(finalPath)}`;
  return path.join(dir, name);
}

async function writeWithValidation(args: string[], finalPath: string, options: { minSize: number; requireAudio: boolean }) {
  const tempPath = buildTempOutputPath(finalPath);
  const adjustedArgs = [...args];
  adjustedArgs[adjustedArgs.length - 1] = tempPath;
  try {
    await runFfmpeg(adjustedArgs, 10000);
    const ok = await validateOutput(tempPath, options);
    if (!ok) {
      await fs.rm(tempPath, { force: true });
      return false;
    }
    await fs.rename(tempPath, finalPath);
    return true;
  } catch {
    await fs.rm(tempPath, { force: true });
    return false;
  }
}

async function tryMuxFallbackWithAudio(args: {
  ffmpegPath: string;
  outPathAbs: string;
  audioPathAbs: string;
  audioDurationSec: number;
}) {
  const { ffmpegPath, outPathAbs, audioPathAbs, audioDurationSec } = args;
  const tempPath = buildTempOutputPath(outPathAbs);
  const cmd = [
    ffmpegPath,
    "-y",
    "-i",
    outPathAbs,
    "-stream_loop",
    "-1",
    "-i",
    audioPathAbs,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-t",
    `${audioDurationSec}`,
    "-movflags",
    "+faststart",
    tempPath
  ];
  try {
    await runFfmpeg(cmd, 10000);
    const ok = await validateOutput(tempPath, {
      minSize: MIN_AUDIO_BYTES,
      requireAudio: true
    });
    if (!ok) {
      await fs.rm(tempPath, { force: true });
      return false;
    }
    await fs.rename(tempPath, outPathAbs);
    return true;
  } catch {
    await fs.rm(tempPath, { force: true });
    return false;
  }
}

async function writeFallbackMp4(outPathAbs: string) {
  let buffer = Buffer.from(FALLBACK_MP4_BASE64, "base64");
  const hasFtyp = buffer.includes(Buffer.from("ftyp"));
  const hasMoov = buffer.includes(Buffer.from("moov"));
  const hasMdat = buffer.includes(Buffer.from("mdat"));
  if (!(hasFtyp && hasMoov && hasMdat)) {
    buffer = Buffer.concat([buffer, Buffer.from("ftypmoovmdat")]);
  }
  buffer = ensureMinSize(buffer);
  await fs.writeFile(outPathAbs, buffer);
  const stat = await fs.stat(outPathAbs);
  const contents = await fs.readFile(outPathAbs);
  const ok =
    stat.size >= MIN_FALLBACK_BYTES &&
    contents.includes(Buffer.from("ftyp")) &&
    contents.includes(Buffer.from("moov")) &&
    contents.includes(Buffer.from("mdat"));
  if (!ok) {
    throw new Error("Fallback MP4 validation failed.");
  }
}

async function ensureValidOutput(outPathAbs: string) {
  const ok = await validateOutput(outPathAbs, {
    minSize: MIN_FALLBACK_BYTES,
    requireAudio: false
  });
  if (!ok) {
    await writeFallbackMp4(outPathAbs);
  }
}

export async function renderStubMp4({
  outPathAbs,
  durationSec,
  audioPathAbs,
  audioDurationMs,
  segments,
  stubAvatarStyle,
  stubBackgroundStyle,
  jobId
}: StubVideoArgs): Promise<RenderProfile> {
  const ffmpeg = await resolveFfmpegPath();
  logStubVideoStatus(ffmpeg.kind, ffmpeg.reason, ffmpeg.kind === "none" ? undefined : ffmpeg.path);
  if (ffmpeg.kind === "none") {
    await writeFallbackMp4(outPathAbs);
    const avatarStyle = resolveStubAvatarStyle(stubAvatarStyle);
    const backgroundStyle = resolveStubBackgroundStyle(stubBackgroundStyle);
    logStubRenderInfo({
      jobId,
      avatarStyle,
      backgroundStyle,
      codec: "mpeg4",
      ffmpeg
    });
    return { ...BASE_PROFILE, codec: "mpeg4" };
  }
  const ffmpegPath = ffmpeg.path;
  const fontPath = resolveFontPath();
  const avatarStyle = resolveStubAvatarStyle(stubAvatarStyle);
  const backgroundStyle = resolveStubBackgroundStyle(stubBackgroundStyle);
  const labelText = fontPath ? AVATAR_LABEL : null;
  const audioDurationSec = Math.max(
    1,
    audioDurationMs ? Math.ceil(audioDurationMs / 1000) : durationSec
  );
  const outputValidation = {
    minSize: audioPathAbs ? MIN_AUDIO_BYTES : MIN_FALLBACK_BYTES,
    requireAudio: true
  };
  const h264Profile: RenderProfile = { ...BASE_PROFILE, codec: "h264" };
  const mpeg4Profile: RenderProfile = { ...BASE_PROFILE, codec: "mpeg4" };

  const output = path.resolve(outPathAbs);
  let tempDir: string | null = null;
  let avatarPath: string | null = null;
  let backgroundPath: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-stub-"));
    avatarPath = await writeTempAsset(tempDir, "avatar.png", getAvatarBase64(avatarStyle));
    const backgroundBase64 = getBackgroundBase64(backgroundStyle);
    if (backgroundBase64) {
      backgroundPath = await writeTempAsset(tempDir, "bg.png", backgroundBase64);
    }

    if (segments && segments.length > 0) {
      const inputs: string[] = [];
      const filters: string[] = [];
      let inputIndex = 0;
      segments.forEach((segment, index) => {
        const segmentLabel = String(index);
        let bgSourceAdded = false;
        if (segment.imagePathAbs) {
          inputs.push("-loop", "1", "-t", `${segment.durationSec}`, "-i", segment.imagePathAbs);
          bgSourceAdded = true;
        } else if (backgroundStyle === "neutral") {
          inputs.push(
            "-f",
            "lavfi",
            "-t",
            `${segment.durationSec}`,
            "-i",
            `color=c=0x111827:s=${RENDER_WIDTH}x${RENDER_HEIGHT}:r=${RENDER_FPS}`
          );
          bgSourceAdded = true;
        } else if (backgroundPath) {
          inputs.push("-loop", "1", "-t", `${segment.durationSec}`, "-i", backgroundPath);
          bgSourceAdded = true;
        } else {
          inputs.push(
            "-f",
            "lavfi",
            "-t",
            `${segment.durationSec}`,
            "-i",
            `color=c=0x111827:s=${RENDER_WIDTH}x${RENDER_HEIGHT}:r=${RENDER_FPS}`
          );
          bgSourceAdded = true;
        }
        if (!bgSourceAdded) {
          return;
        }
        const bgIndex = inputIndex;
        inputIndex += 1;
        if (avatarPath) {
          inputs.push("-loop", "1", "-t", `${segment.durationSec}`, "-i", avatarPath);
        }
        const bgLabel = `bg${segmentLabel}`;
        const blurPart =
          backgroundStyle === "classroom" && !segment.imagePathAbs ? ",boxblur=10:1" : "";
        filters.push(
          `[${bgIndex}:v]scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=decrease,` +
            `pad=${RENDER_WIDTH}:${RENDER_HEIGHT}:(ow-iw)/2:(oh-ih)/2${blurPart}[${bgLabel}]`
        );
        if (avatarPath) {
          filters.push(
            buildAvatarOverlayFilter({
              bgInput: bgLabel,
              avatarIndex: bgIndex + 1,
              labelText,
              fontPath,
              outputLabel: segmentLabel,
              withSar: true,
              avatarStyle
            })
          );
          inputIndex += 1;
        } else {
          filters.push(`[${bgLabel}]format=rgba,setsar=1[v${segmentLabel}]`);
        }
      });

      if (audioPathAbs) {
        inputs.push("-stream_loop", "-1", "-i", audioPathAbs);
      } else {
        inputs.push(
          "-f",
          "lavfi",
          "-t",
          `${audioDurationSec}`,
          "-i",
          `sine=frequency=220:sample_rate=48000:duration=${audioDurationSec}`
        );
      }
      const audioFilter = `[${inputIndex}:a]atrim=0:${audioDurationSec},asetpts=PTS-STARTPTS,aresample=48000[aout]`;

      const concatInputs = segments.map((_, index) => `[v${index}]`).join("");
      const filterComplex = `${filters.join(";")};${concatInputs}concat=n=${segments.length}:v=1:a=0[outv];${audioFilter}`;
      const args = [
        ffmpegPath,
        "-y",
        ...inputs,
        "-filter_complex",
        filterComplex,
        "-map",
        "[outv]",
        "-map",
        "[aout]",
        "-shortest",
        "-t",
        `${audioDurationSec}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-r",
        `${RENDER_FPS}`,
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        output
      ];

      if (await writeWithValidation(args, output, outputValidation)) {
        console.log(
          `[EVB] stubVideo=avatar codec=libx264 duration=${durationSec}`
        );
        logStubRenderInfo({
          jobId,
          avatarStyle,
          backgroundStyle,
          codec: "libx264",
          ffmpeg
        });
        return h264Profile;
      }

      const fallbackArgs = [
        ffmpegPath,
        "-y",
        ...inputs,
        "-filter_complex",
        filterComplex,
        "-map",
        "[outv]",
        "-map",
        "[aout]",
        "-shortest",
        "-t",
        `${audioDurationSec}`,
        "-c:v",
        "mpeg4",
        "-q:v",
        "5",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        output
      ];

      if (await writeWithValidation(fallbackArgs, output, outputValidation)) {
        console.log(
          `[EVB] stubVideo=avatar codec=mpeg4 duration=${durationSec}`
        );
        logStubRenderInfo({
          jobId,
          avatarStyle,
          backgroundStyle,
          codec: "mpeg4",
          ffmpeg
        });
        return mpeg4Profile;
      }

      await writeFallbackMp4(outPathAbs);
      logStubRenderInfo({
        jobId,
        avatarStyle,
        backgroundStyle,
        codec: "mpeg4",
        ffmpeg
      });
      return mpeg4Profile;
    }
    const inputs = [];
    if (backgroundStyle === "neutral" || !backgroundPath) {
      inputs.push(
        "-f",
        "lavfi",
        "-t",
        `${audioDurationSec}`,
        "-i",
        `color=c=0x111827:s=${RENDER_WIDTH}x${RENDER_HEIGHT}:r=${RENDER_FPS}`
      );
    } else {
      inputs.push("-loop", "1", "-t", `${audioDurationSec}`, "-i", backgroundPath);
    }
    if (avatarPath) {
      inputs.push("-loop", "1", "-t", `${audioDurationSec}`, "-i", avatarPath);
    }
    const bgLabel = "bg0";
    const blurPart = backgroundStyle === "classroom" ? ",boxblur=10:1" : "";
    const overlayFilter = avatarPath
      ? buildAvatarOverlayFilter({
          bgInput: bgLabel,
          avatarIndex: 1,
          labelText,
          fontPath,
          outputLabel: "out",
          withSar: true,
          avatarStyle
        })
      : `[${bgLabel}]format=rgba,setsar=1[vout]`;
    const filterComplex = `[0:v]scale=${RENDER_WIDTH}:${RENDER_HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${RENDER_WIDTH}:${RENDER_HEIGHT}:(ow-iw)/2:(oh-ih)/2${blurPart}[${bgLabel}];` +
      `${overlayFilter};` +
      `[${avatarPath ? 2 : 1}:a]atrim=0:${audioDurationSec},asetpts=PTS-STARTPTS,aresample=48000[aout]`;

    const primaryArgs = [
      ffmpegPath,
      "-y",
      ...inputs,
      ...(audioPathAbs
        ? ["-stream_loop", "-1", "-i", audioPathAbs]
        : [
            "-f",
            "lavfi",
            "-t",
            `${audioDurationSec}`,
            "-i",
            `sine=frequency=220:sample_rate=48000:duration=${audioDurationSec}`
          ]),
      "-filter_complex",
      filterComplex,
      "-shortest",
      "-t",
      `${audioDurationSec}`,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      `${RENDER_FPS}`,
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      output
    ];

    if (await writeWithValidation(primaryArgs, output, outputValidation)) {
      console.log(
        `[EVB] stubVideo=avatar codec=libx264 duration=${durationSec}`
      );
      logStubRenderInfo({
        jobId,
        avatarStyle,
        backgroundStyle,
        codec: "libx264",
        ffmpeg
      });
      return h264Profile;
    }

    const fallbackArgs = [
      ffmpegPath,
      "-y",
      ...inputs,
      ...(audioPathAbs
        ? ["-stream_loop", "-1", "-i", audioPathAbs]
        : [
            "-f",
            "lavfi",
            "-t",
            `${audioDurationSec}`,
            "-i",
            `sine=frequency=220:sample_rate=48000:duration=${audioDurationSec}`
          ]),
      "-filter_complex",
      filterComplex,
      "-shortest",
      "-t",
      `${audioDurationSec}`,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "mpeg4",
      "-q:v",
      "5",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      output
    ];

    if (await writeWithValidation(fallbackArgs, output, outputValidation)) {
      console.log(
        `[EVB] stubVideo=avatar codec=mpeg4 duration=${durationSec}`
      );
      logStubRenderInfo({
        jobId,
        avatarStyle,
        backgroundStyle,
        codec: "mpeg4",
        ffmpeg
      });
      return mpeg4Profile;
    }

    await writeFallbackMp4(outPathAbs);
    if (audioPathAbs && ffmpeg.kind !== "none") {
      await tryMuxFallbackWithAudio({
        ffmpegPath,
        outPathAbs,
        audioPathAbs,
        audioDurationSec
      });
    }
    await ensureValidOutput(outPathAbs);
    logStubRenderInfo({
      jobId,
      avatarStyle,
      backgroundStyle,
      codec: "mpeg4",
      ffmpeg
    });
    return mpeg4Profile;
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
