import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderClip } from "./renderClip";
import { startLocalAvatarEmulator } from "./__testutils__/localAvatarEngineEmulator";
import type { ApprovedManifest, GenerationSettings } from "@evb/shared";

describe("renderClip (local_musetalk)", () => {
  const originalEnv = { ...process.env };
  const originalDisable = process.env.EVB_DISABLE_FFMPEG;
  let tempDir = "";
  let generateStubArtifacts: typeof import("../../lib/stubArtifacts").generateStubArtifacts;
  let getArtifactFilePaths: typeof import("../../lib/stubArtifacts").getArtifactFilePaths;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-render-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    ({ generateStubArtifacts, getArtifactFilePaths } = await import("../../lib/stubArtifacts"));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    process.env = originalEnv;
    if (originalDisable === undefined) {
      delete process.env.EVB_DISABLE_FFMPEG;
    } else {
      process.env.EVB_DISABLE_FFMPEG = originalDisable;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("renders via local avatar engine emulator", async () => {
    const emulator = await startLocalAvatarEmulator();
    try {
      process.env.EVB_LOCAL_AVATAR_URL = emulator.url;
      process.env.EVB_LOCAL_AVATAR_TIMEOUT_MS = "2000";

      const outputPath = path.join(tempDir, "clip.mp4");
      const profile = await renderClip({
        provider: "local_musetalk",
        clipId: "clip-1",
        outputPathAbs: outputPath,
        durationSec: 2,
        audioPathAbs: "C:\\audio\\clip-1.mp3",
        audioDurationMs: 1500,
        transcript: "Hello world",
        avatarPresetId: "local_musetalk",
        fallbackProfile: {
          width: 1280,
          height: 720,
          fps: 30,
          codec: "mpeg4",
          pixelFormat: "yuv420p"
        }
      });

      const buffer = await fs.readFile(outputPath);
      expect(buffer.length).toBeGreaterThan(2048);
      expect(buffer.includes(Buffer.from("ftyp"))).toBe(true);
      expect(profile.width).toBe(1280);
    } finally {
      await emulator.close();
    }
  });

  it("writes local mp4 and preserves manifest outside allowed fields", async () => {
    const emulator = await startLocalAvatarEmulator({
      statusSequence: ["queued", "running", "succeeded"]
    });
    try {
      process.env.EVB_DISABLE_FFMPEG = "1";
      process.env.EVB_LOCAL_AVATAR_URL = emulator.url;
      process.env.EVB_LOCAL_AVATAR_TIMEOUT_MS = "5000";

      const manifest: ApprovedManifest = {
        manifestVersion: "0.1",
        courseTitle: "Course",
        approvedAt: "2024-01-01T00:00:00.000Z",
        draftSignature: "sig",
        sections: [
          { id: "s1", title: "Intro", script: "Hello world. Second sentence." }
        ]
      };
      const settings: GenerationSettings = {
        outputMode: "avatar_only",
        avatarPresetId: "local_musetalk",
        voicePresetId: "stub_voice_en_us_1",
        stylePresetId: "stub_style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 1,
        updatedAt: "2024-01-01T00:00:00.000Z"
      };
      const jobId = "job-local";

      await generateStubArtifacts({
        jobId,
        manifest,
        settings,
        avatarProvider: "stub"
      });
      const baseline = JSON.parse(
        await fs.readFile(getArtifactFilePaths(jobId).manifestAbs, "utf8")
      );

      const localArtifacts = await generateStubArtifacts({
        jobId,
        manifest,
        settings,
        avatarProvider: "local_musetalk"
      });
      expect(localArtifacts.mp4Path).toContain(`/v1/jobs/${jobId}/artifacts/video.mp4`);
      const localManifest = JSON.parse(
        await fs.readFile(getArtifactFilePaths(jobId).manifestAbs, "utf8")
      );

      const stripAllowed = (value: any) => {
        const clone = JSON.parse(JSON.stringify(value));
        delete clone.provider;
        if (Array.isArray(clone.sections)) {
          clone.sections.forEach((section: any) => {
            if (!Array.isArray(section.variations)) {
              return;
            }
            section.variations.forEach((variation: any) => {
              if (!Array.isArray(variation.clips)) {
                return;
              }
              variation.clips.forEach((clip: any) => {
                if (clip.render && typeof clip.render === "object") {
                  delete clip.render.provider;
                  delete clip.render.completedAt;
                  delete clip.render.durationMs;
                }
              });
            });
          });
        }
        return clone;
      };

      expect(stripAllowed(localManifest)).toEqual(stripAllowed(baseline));

      const firstClip = localManifest.sections?.[0]?.variations?.[0]?.clips?.[0];
      const clipRelPath = String(firstClip?.mp4Path);
      const artifactsRoot = getArtifactFilePaths(jobId).dir;
      const clipAbsPath = path.join(artifactsRoot, ...clipRelPath.split("/").slice(1));
      const stats = await fs.stat(clipAbsPath);
      expect(stats.size).toBeGreaterThan(2048);
    } finally {
      await emulator.close();
    }
  });
});
