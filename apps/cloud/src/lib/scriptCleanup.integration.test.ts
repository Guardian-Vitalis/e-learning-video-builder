import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ApprovedManifest, GenerationSettings } from "@evb/shared";

describe("script cleanup integration", () => {
  const originalDisable = process.env.EVB_DISABLE_FFMPEG;
  let tempDir = "";
  let generateStubArtifacts: typeof import("./stubArtifacts").generateStubArtifacts;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-cleanup-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    process.env.EVB_DISABLE_FFMPEG = "1";
    ({ generateStubArtifacts } = await import("./stubArtifacts"));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (originalDisable === undefined) {
      delete process.env.EVB_DISABLE_FFMPEG;
    } else {
      process.env.EVB_DISABLE_FFMPEG = originalDisable;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes cleaned narration and warnings into manifest", async () => {
    const manifest: ApprovedManifest = {
      manifestVersion: "0.1",
      courseTitle: "Course",
      approvedAt: "2024-01-01T00:00:00.000Z",
      draftSignature: "sig",
      cleanupMode: "deterministic",
      sections: [
        {
          id: "s1",
          title: "Intro",
          script: "- Clean operation\nactivat ion occurs."
        }
      ]
    };
    const settings: GenerationSettings = {
      outputMode: "avatar_only",
      avatarPresetId: "avatar_a",
      voicePresetId: "voice_1",
      stylePresetId: "style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1,
      updatedAt: "2024-01-01T00:00:00.000Z"
    };

    await generateStubArtifacts({
      jobId: "job-cleanup",
      manifest,
      settings,
      scriptCleanupMode: "deterministic"
    });

    const manifestPath = path.join(tempDir, ".artifacts", "job-cleanup", "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    const json = JSON.parse(raw) as {
      cleanupMode?: string;
      sections: Array<{
        cleanedNarrationText?: string;
        cleanupWarnings?: string[];
        variations: Array<{ cleanedNarrationText?: string }>;
      }>;
    };
    expect(json.cleanupMode).toBe("deterministic");
    expect(json.sections[0].cleanedNarrationText).toContain("activation");
    expect(json.sections[0].cleanupWarnings).toContain("bullets_normalized");
    expect(json.sections[0].variations[0].cleanedNarrationText).toContain("activation");
  });
});
