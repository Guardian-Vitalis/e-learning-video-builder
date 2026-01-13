import { afterEach, describe, expect, it } from "vitest";
import { jobStoreMemory, resetJobStoreMemory } from "./jobStoreMemory";

describe("jobStoreMemory", () => {
  afterEach(() => {
    resetJobStoreMemory();
  });

  it("creates, updates, and returns artifacts", async () => {
    const input = {
      manifest: {
        manifestVersion: "0.1",
        courseTitle: "Memory Test",
        approvedAt: new Date().toISOString(),
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "Hello" }]
      },
      projectId: "p1",
      settings: {
        outputMode: "avatar_only",
        avatarPresetId: "stub_avatar_m1",
        voicePresetId: "stub_voice_en_us_1",
        stylePresetId: "stub_style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 1,
        updatedAt: new Date().toISOString()
      }
    };

    const job = await jobStoreMemory.createJob(input);
    const fetched = await jobStoreMemory.getJob(job.id);
    expect(fetched?.status).toBe("queued");
    expect(fetched?.sectionsProgress?.length).toBe(1);

    await jobStoreMemory.setRunning(job.id, { phase: "rendering", pct: 50 });
    const running = await jobStoreMemory.getJob(job.id);
    expect(running?.status).toBe("running");

    const artifacts = {
      mp4Path: "/v1/jobs/x/artifacts/video.mp4",
      vttPath: "/v1/jobs/x/artifacts/captions.vtt",
      srtPath: "/v1/jobs/x/artifacts/captions.srt",
      expiresAt: new Date().toISOString()
    };
    await jobStoreMemory.setSucceeded(job.id, artifacts);
    const done = await jobStoreMemory.getJob(job.id);
    expect(done?.status).toBe("succeeded");
    expect(done?.artifacts).toEqual(artifacts);
  });
});
