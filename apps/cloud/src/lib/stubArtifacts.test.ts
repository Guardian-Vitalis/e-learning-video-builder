import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { buildCaptionsForManifest, generateStubArtifacts } from "./stubArtifacts";
import type { ApprovedManifest, GenerationSettings } from "@evb/shared";
import path from "node:path";

vi.mock("node:fs", () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock("../worker/render/renderClip", () => ({
  renderClip: vi
    .fn()
    .mockResolvedValue({ width: 1280, height: 720, fps: 30, codec: "h264", pixelFormat: "yuv420p" })
}));

vi.mock("./audio/audioProvider", () => ({
  getAudioProvider: () => ({
    synthesize: vi.fn().mockImplementation(({ text }) =>
      Promise.resolve({
        path: "C:\\tmp\\stub-audio.m4a",
        durationMs: text.trim().length === 0 ? 3000 : 11000,
        kind: "placeholder"
      })
    )
  })
}));

describe("stubArtifacts", () => {
  const manifest: ApprovedManifest = {
    manifestVersion: "0.1",
    courseTitle: "Course",
    approvedAt: "2024-01-01T00:00:00.000Z",
    draftSignature: "sig",
    sections: [
      { id: "s1", title: "Intro", script: "Hello world. Second sentence." },
      { id: "s2", title: "Next", script: "Third sentence." }
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

  const getMocks = async () => {
    const fs = await import("node:fs");
    const { renderClip } = await import("../worker/render/renderClip");
    return {
      writeFile: fs.promises.writeFile as Mock,
      renderClip: renderClip as Mock
    };
  };

  beforeEach(async () => {
    const { writeFile, renderClip } = await getMocks();
    writeFile.mockClear();
    renderClip.mockClear();
  });

  it("writes captions from section scripts and renders a matching mp4", async () => {
    const { writeFile, renderClip } = await getMocks();
    const artifacts = await generateStubArtifacts({
      jobId: "job-1",
      manifest,
      settings
    });

    expect(writeFile).toHaveBeenCalled();
    const manifestWrite = writeFile.mock.calls.find((call) =>
      String(call[0]).endsWith("manifest.json")
    );
    expect(manifestWrite).toBeTruthy();
    const renderArgs = renderClip.mock.calls[0]?.[0] as {
      audioPathAbs: string;
      audioDurationMs: number;
      stubAvatarStyle?: string;
      stubBackgroundStyle?: string;
    };
    expect(renderArgs.audioPathAbs).toBe("C:\\tmp\\stub-audio.m4a");
    expect(renderArgs.audioDurationMs).toBe(11000);
    expect(renderArgs.stubAvatarStyle).toBe("silhouette");
    expect(renderArgs.stubBackgroundStyle).toBe("neutral");
    expect(renderClip).toHaveBeenCalled();
    expect(artifacts.mp4Path).toContain("/v1/jobs/job-1/artifacts/video.mp4");
  });

  it("renders a short video when scripts are empty", async () => {
    const { renderClip } = await getMocks();
    await generateStubArtifacts({
      jobId: "job-2",
      manifest: {
        ...manifest,
        sections: [
          { id: "s1", title: "Empty", script: "   " },
          { id: "s2", title: "Empty", script: "" }
        ]
      },
      settings
    });

    expect(renderClip).toHaveBeenCalled();
  });

  it("builds a fallback caption when scripts are empty", () => {
    const result = buildCaptionsForManifest(
      {
        ...manifest,
        sections: [{ id: "s1", title: "Empty", script: "" }]
      },
      settings
    );

    expect(result.vtt.startsWith("WEBVTT")).toBe(true);
    expect(result.cues.length).toBe(1);
  });

  it("uses table image background when section images are provided", async () => {
    const { renderClip } = await getMocks();
    const relPath = "data/jobs/job-3/inputs/table-images/img-1.png";

    await generateStubArtifacts({
      jobId: "job-3",
      manifest,
      settings: { ...settings, outputMode: "avatar_plus_slides" },
      sectionImages: { s1: relPath }
    });

    const expectedAbs = path.resolve(process.cwd(), relPath);
    expect(renderClip).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentImageAbs: expectedAbs
      })
    );
  });

  it("does not use table image backgrounds when none are provided", async () => {
    const { renderClip } = await getMocks();

    await generateStubArtifacts({
      jobId: "job-4",
      manifest,
      settings: { ...settings, outputMode: "avatar_only" }
    });

    expect(renderClip).toHaveBeenCalledWith(
      expect.objectContaining({ segmentImageAbs: undefined })
    );
  });
});
