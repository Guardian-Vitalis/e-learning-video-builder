import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderStubMp4 } from "./stubVideo";
import { getAudioProvider } from "./audio/audioProvider";

describe("stubVideo fallback", () => {
  const originalDisable = process.env.EVB_DISABLE_FFMPEG;
  const originalAllow = process.env.EVB_ALLOW_FFMPEG_STATIC;

  beforeEach(() => {
    process.env.EVB_DISABLE_FFMPEG = "1";
    delete process.env.EVB_ALLOW_FFMPEG_STATIC;
  });

  afterEach(() => {
    if (originalDisable === undefined) {
      delete process.env.EVB_DISABLE_FFMPEG;
    } else {
      process.env.EVB_DISABLE_FFMPEG = originalDisable;
    }
    if (originalAllow === undefined) {
      delete process.env.EVB_ALLOW_FFMPEG_STATIC;
    } else {
      process.env.EVB_ALLOW_FFMPEG_STATIC = originalAllow;
    }
  });

  it("writes a non-empty MP4 buffer when ffmpeg is unavailable", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-mp4-"));
    const outPath = path.join(dir, "video.mp4");

    await renderStubMp4({ outPathAbs: outPath, durationSec: 1 });

    const buffer = await fs.readFile(outPath);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.length).toBeGreaterThanOrEqual(2048);
    expect(buffer.includes(Buffer.from("ftyp"))).toBe(true);
    expect(buffer.includes(Buffer.from("moov"))).toBe(true);
    expect(buffer.includes(Buffer.from("mdat"))).toBe(true);
  });
});

describe("stubVideo ffmpeg avatar", () => {
  const originalDisable = process.env.EVB_DISABLE_FFMPEG;
  const originalFfmpegPath = process.env.EVB_FFMPEG_PATH;
  const originalProvider = process.env.EVB_TTS_PROVIDER;

  const runFfmpeg = process.env.EVB_RUN_FFMPEG_TESTS === "1";
  const maybeIt = runFfmpeg ? it : it.skip;

  beforeEach(() => {
    delete process.env.EVB_DISABLE_FFMPEG;
    delete process.env.EVB_FFMPEG_PATH;
    process.env.EVB_TTS_PROVIDER = "stub";
  });

  afterEach(() => {
    if (originalDisable === undefined) {
      delete process.env.EVB_DISABLE_FFMPEG;
    } else {
      process.env.EVB_DISABLE_FFMPEG = originalDisable;
    }
    if (originalFfmpegPath === undefined) {
      delete process.env.EVB_FFMPEG_PATH;
    } else {
      process.env.EVB_FFMPEG_PATH = originalFfmpegPath;
    }
    if (originalProvider === undefined) {
      delete process.env.EVB_TTS_PROVIDER;
    } else {
      process.env.EVB_TTS_PROVIDER = originalProvider;
    }
  });

  maybeIt("renders an avatar MP4 when ffmpeg is available", async () => {
    const mod = await import("ffmpeg-static");
    const candidate = (mod as { default?: unknown } | unknown) as { default?: unknown } | unknown;
    const resolved =
      typeof candidate === "object" && candidate !== null && "default" in candidate
        ? (candidate as { default?: unknown }).default
        : candidate;
    const ffmpegPath = typeof resolved === "string" ? resolved : "";
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
      return;
    }
    process.env.EVB_FFMPEG_PATH = ffmpegPath;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-mp4-"));
    const outPath = path.join(dir, "video.mp4");

    await renderStubMp4({ outPathAbs: outPath, durationSec: 3 });

    const buffer = await fs.readFile(outPath);
    expect(buffer.length).toBeGreaterThan(10 * 1024);
    expect(buffer.includes(Buffer.from("ftyp"))).toBe(true);
    expect(buffer.includes(Buffer.from("moov"))).toBe(true);
    expect(buffer.includes(Buffer.from("mdat"))).toBe(true);
    expect(buffer.includes(Buffer.from("vide"))).toBe(true);
    expect(buffer.includes(Buffer.from("soun"))).toBe(true);
  });

  maybeIt("muxes placeholder audio into the mp4 output", async () => {
    const mod = await import("ffmpeg-static");
    const candidate = (mod as { default?: unknown } | unknown) as { default?: unknown } | unknown;
    const resolved =
      typeof candidate === "object" && candidate !== null && "default" in candidate
        ? (candidate as { default?: unknown }).default
        : candidate;
    const ffmpegPath = typeof resolved === "string" ? resolved : "";
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
      return;
    }
    process.env.EVB_FFMPEG_PATH = ffmpegPath;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-mp4-"));
    const outPath = path.join(dir, "video.mp4");
    const provider = getAudioProvider();
    const audio = await provider.synthesize({
      text: "Hello world. This is a stub lesson.",
      voice: "stub",
      style: "clean"
    });

    await renderStubMp4({
      outPathAbs: outPath,
      durationSec: Math.ceil(audio.durationMs / 1000),
      audioPathAbs: audio.path,
      audioDurationMs: audio.durationMs
    });

    const buffer = await fs.readFile(outPath);
    expect(buffer.length).toBeGreaterThan(10 * 1024);
    expect(buffer.includes(Buffer.from("vide"))).toBe(true);
    expect(buffer.includes(Buffer.from("soun"))).toBe(true);
  });

  maybeIt("renders a clip with beep-mixed placeholder audio", async () => {
    const mod = await import("ffmpeg-static");
    const candidate = (mod as { default?: unknown } | unknown) as { default?: unknown } | unknown;
    const resolved =
      typeof candidate === "object" && candidate !== null && "default" in candidate
        ? (candidate as { default?: unknown }).default
        : candidate;
    const ffmpegPath = typeof resolved === "string" ? resolved : "";
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
      return;
    }
    process.env.EVB_FFMPEG_PATH = ffmpegPath;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-mp4-"));
    const outPath = path.join(dir, "video.mp4");
    const provider = getAudioProvider();
    const audio = await provider.synthesize({
      text: "Beep timing check.",
      voice: "stub",
      style: "clean",
      timing: { cueStartsMs: [1000, 2412], durationMs: 4000 }
    });

    await renderStubMp4({
      outPathAbs: outPath,
      durationSec: Math.ceil(audio.durationMs / 1000),
      audioPathAbs: audio.path,
      audioDurationMs: audio.durationMs
    });

    const buffer = await fs.readFile(outPath);
    expect(buffer.length).toBeGreaterThan(10 * 1024);
    expect(buffer.includes(Buffer.from("vide"))).toBe(true);
    expect(buffer.includes(Buffer.from("soun"))).toBe(true);
  });
});
