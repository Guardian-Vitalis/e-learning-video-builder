import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getRedis } from "../redis/client";
const SHOULD_RUN =
  process.env.EVB_RUN_REDIS_TESTS === "1" && Boolean(process.env.REDIS_URL);

if (!SHOULD_RUN) {
  console.log(
    "[test] Skipping Redis tests. Set EVB_RUN_REDIS_TESTS=1 and REDIS_URL to enable."
  );
}

const suite = SHOULD_RUN ? describe : describe.skip;

suite("jobStoreRedis", () => {
  let jobStoreRedis: typeof import("./jobStoreRedis").jobStoreRedis;
  let getJobKeyPrefix: typeof import("./jobStoreRedis").getJobKeyPrefix;
  let getJobInputKeyPrefix: typeof import("./jobStoreRedis").getJobInputKeyPrefix;
  const instanceId = `test-${Math.random().toString(16).slice(2)}`;
  const createdJobIds: string[] = [];

  beforeAll(async () => {
    process.env.EVB_INSTANCE_ID = instanceId;
    vi.resetModules();
    const redisStore = await import("./jobStoreRedis");
    jobStoreRedis = redisStore.jobStoreRedis;
    getJobKeyPrefix = redisStore.getJobKeyPrefix;
    getJobInputKeyPrefix = redisStore.getJobInputKeyPrefix;
  });

  afterAll(async () => {
    if (createdJobIds.length > 0) {
      const keys = createdJobIds.flatMap((id) => [
        `${getJobKeyPrefix(instanceId)}${id}`,
        `${getJobInputKeyPrefix(instanceId)}${id}`
      ]);
      await getRedis().del(...keys);
    }
    await getRedis().quit();
  });

  it("creates, updates, and returns artifacts", async () => {
    const input = {
      manifest: {
        manifestVersion: "0.1",
        courseTitle: "Redis Test",
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
    const job = await jobStoreRedis.createJob(input);

    createdJobIds.push(job.id);
    const fetched = await jobStoreRedis.getJob(job.id);
    expect(fetched?.id).toBe(job.id);
    expect(fetched?.status).toBe("queued");
    expect(fetched?.sectionsProgress?.length).toBe(1);
    expect(fetched?.sectionsProgress?.[0].status).toBe("queued");

    const storedInput = await jobStoreRedis.getJobInput(job.id);
    expect(storedInput).toEqual(input);

    const inputTableImages = [
      {
        id: "img-1",
        sectionId: "s1",
        anchorText: "Table cell",
        relPath: "data/jobs/job-1/inputs/table-images/img-1.png",
        mimeType: "image/png"
      }
    ];

    await jobStoreRedis.updateJob(job.id, { inputTableImages });

    const withInputs = await jobStoreRedis.getJob(job.id);
    expect(withInputs?.inputTableImages).toEqual(inputTableImages);

    await jobStoreRedis.setRunning(job.id, { phase: "rendering", pct: 50 });

    const sectionId = fetched?.sectionsProgress?.[0].sectionId ?? "s1";
    await jobStoreRedis.updateJobSectionProgress(job.id, sectionId, {
      status: "running",
      phase: "clips",
      pct: 40
    });

    const running = await jobStoreRedis.getJob(job.id);
    expect(running?.sectionsProgress?.[0].status).toBe("running");
    expect(running?.sectionsProgress?.[0].pct).toBe(40);

    await jobStoreRedis.updateJobSectionProgress(job.id, sectionId, {
      status: "succeeded",
      phase: "done",
      pct: 100
    });

    const done = await jobStoreRedis.getJob(job.id);
    expect(done?.sectionsProgress?.[0].status).toBe("succeeded");
    expect(done?.sectionsProgress?.[0].pct).toBe(100);

    const artifacts = {
      mp4Path: "/v1/jobs/x/artifacts/video.mp4",
      vttPath: "/v1/jobs/x/artifacts/captions.vtt",
      srtPath: "/v1/jobs/x/artifacts/captions.srt",
      expiresAt: new Date().toISOString()
    };

    await jobStoreRedis.setSucceeded(job.id, artifacts);

    const finalJob = await jobStoreRedis.getJob(job.id);
    expect(finalJob?.status).toBe("succeeded");
    expect(finalJob?.artifacts).toEqual(artifacts);
  });
});
