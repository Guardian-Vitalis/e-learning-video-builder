import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ApprovedManifest, GenerationSettings } from "@evb/shared";

describe("stubArtifacts manifest", () => {
  const originalDisable = process.env.EVB_DISABLE_FFMPEG;
  let tempDir = "";
  let generateStubArtifacts: typeof import("./stubArtifacts").generateStubArtifacts;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-artifacts-"));
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

  it("writes manifest with variations and clip artifacts", async () => {
    const manifest: ApprovedManifest = {
      manifestVersion: "0.1",
      courseTitle: "Course",
      approvedAt: "2024-01-01T00:00:00.000Z",
      draftSignature: "sig",
      sections: [
        {
          id: "s1",
          title: "Intro",
          script: "One. Two. Three. Four. Five."
        }
      ]
    };
    const settings: GenerationSettings = {
      outputMode: "avatar_only",
      avatarPresetId: "avatar_a",
      voicePresetId: "voice_1",
      stylePresetId: "style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 3,
      updatedAt: "2024-01-01T00:00:00.000Z"
    };

    await generateStubArtifacts({
      jobId: "job-manifest",
      manifest,
      settings
    });

    const manifestPath = path.join(tempDir, ".artifacts", "job-manifest", "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    type ClipRender = {
      avatarStyle?: string;
      backgroundStyle?: string;
      profile?: { width: number };
    };
    const json = JSON.parse(raw) as {
      sections: Array<{ variations: Array<{ clips: Array<{ render?: ClipRender }> }> }>;
      primary: { mp4Path: string };
      stubAvatarStyle?: string;
      stubBackgroundStyle?: string;
      renderProfile?: { width: number; height: number };
    };
    expect(json.sections.length).toBe(1);
    expect(json.sections[0].variations.length).toBe(3);
    expect(json.sections[0].variations[0].clips.length).toBe(3);
    const firstClipRender = json.sections[0].variations[0].clips[0]?.render;
    expect(firstClipRender?.avatarStyle).toBe("silhouette");
    expect(firstClipRender?.backgroundStyle).toBe("neutral");
    expect(firstClipRender?.profile?.width).toBe(1280);
    expect(json.stubAvatarStyle).toBe("silhouette");
    expect(json.stubBackgroundStyle).toBe("neutral");
    expect(json.renderProfile?.width).toBe(1280);
    expect(json.renderProfile?.height).toBe(720);

    for (const variation of json.sections[0].variations) {
      for (const clip of variation.clips) {
        const rel = String(clip.mp4Path);
        const parts = rel.split("/");
        const fullPath = path.join(tempDir, ".artifacts", ...parts);
        const buffer = await fs.readFile(fullPath);
        expect(buffer.length).toBeGreaterThanOrEqual(2048);
        expect(buffer.includes(Buffer.from("ftyp"))).toBe(true);
        expect(buffer.includes(Buffer.from("moov"))).toBe(true);
        expect(buffer.includes(Buffer.from("mdat"))).toBe(true);
      }
    }

    const primaryParts = json.primary.mp4Path.split("/");
    const primaryPath = path.join(tempDir, ".artifacts", ...primaryParts);
    const primaryBuffer = await fs.readFile(primaryPath);
    expect(primaryBuffer.length).toBeGreaterThanOrEqual(2048);
  });

  it("writes render metadata for explicit stub styles", async () => {
    const manifest: ApprovedManifest = {
      manifestVersion: "0.1",
      courseTitle: "Course",
      approvedAt: "2024-01-01T00:00:00.000Z",
      draftSignature: "sig",
      sections: [
        {
          id: "s1",
          title: "Intro",
          script: "One. Two. Three."
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
      jobId: "job-render",
      manifest,
      settings,
      stubAvatarStyle: "badge",
      stubBackgroundStyle: "classroom"
    });

    const manifestPath = path.join(tempDir, ".artifacts", "job-render", "manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    type RenderClip = {
      avatarStyle?: string;
      backgroundStyle?: string;
      profile?: { fps: number };
    };
    const json = JSON.parse(raw) as {
      sections: Array<{ variations: Array<{ clips: Array<{ render?: RenderClip }> }> }>;
      stubAvatarStyle?: string;
      stubBackgroundStyle?: string;
      renderProfile?: { width: number; height: number };
    };
    expect(json.stubAvatarStyle).toBe("badge");
    expect(json.stubBackgroundStyle).toBe("classroom");
    expect(json.renderProfile?.width).toBe(1280);
    expect(json.renderProfile?.height).toBe(720);
    const firstRender = json.sections[0].variations[0].clips[0]?.render;
    expect(firstRender?.avatarStyle).toBe("badge");
    expect(firstRender?.backgroundStyle).toBe("classroom");
    expect(firstRender?.profile?.fps).toBe(30);
  });
});
