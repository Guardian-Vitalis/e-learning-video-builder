import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { getRedis } from "../redis/client";
import { jobStoreRedis } from "../store/jobStoreRedis";
import {
  getFailedJobsKey,
  getQueuedJobsKey,
  getRunningJobsKey,
  getJobKeyPrefix,
  getJobInputKeyPrefix
} from "../store/jobStoreRedis";

const SHOULD_RUN =
  process.env.EVB_RUN_REDIS_TESTS === "1" && Boolean(process.env.REDIS_URL);

if (!SHOULD_RUN) {
  console.log(
    "[test] Skipping Redis tests. Set EVB_RUN_REDIS_TESTS=1 and REDIS_URL to enable."
  );
}

const suite = SHOULD_RUN ? describe : describe.skip;

suite("admin routes (redis)", () => {
  const originalEnv = { ...process.env };
  let serverUrl = "";
  let server: Server | null = null;
  let workerController: AbortController | null = null;
  let workerPromise: Promise<void> | null = null;
  let instanceId = "";
  const createdJobIds: string[] = [];

  const baseInput = {
    manifest: {
      manifestVersion: "0.1" as const,
      courseTitle: "Admin Test",
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

  beforeAll(async () => {
    instanceId = `admin-${randomUUID()}`;
    process.env.EVB_RUN_MODE = "split";
    process.env.EVB_STORE = "redis";
    process.env.EVB_QUEUE = "redis";
    process.env.EVB_INSTANCE_ID = instanceId;
    process.env.EVB_DISABLE_FFMPEG = "1";
    process.env.NODE_ENV = "test";

    const { createApp } = await import("../index");
    const { startWorker } = await import("../worker/runWorker");
    const app = createApp();
    const listener = app.listen(0);
    server = listener;
    const address = listener.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to bind test server");
    }
    serverUrl = `http://127.0.0.1:${address.port}`;
    workerController = new AbortController();
    workerPromise = startWorker({ signal: workerController.signal, jobTimeoutMs: 20000 });
  });

  afterAll(async () => {
    try {
      if (workerController) {
        workerController.abort();
      }
      if (workerPromise) {
        try {
          await workerPromise;
        } catch {
          // ignore worker shutdown errors
        }
      }
      if (createdJobIds.length > 0) {
        const redis = getRedis();
        const keys = createdJobIds.flatMap((id) => [
          `${getJobKeyPrefix(instanceId)}${id}`,
          `${getJobInputKeyPrefix(instanceId)}${id}`,
          `evb:${instanceId}:job:${id}:lease`,
          `evb:${instanceId}:job:${id}:events`
        ]);
        await redis.del(...keys);
        await redis.srem(getQueuedJobsKey(instanceId), ...createdJobIds);
        await redis.srem(getRunningJobsKey(instanceId), ...createdJobIds);
        await redis.srem(getFailedJobsKey(instanceId), ...createdJobIds);
        await redis.del(`evb:${instanceId}:recovery:lock`);
        await redis.quit();
      }
    } finally {
      if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
      }
      process.env = originalEnv;
    }
  });

  it("lists running jobs with lease fields", async () => {
    const queued = await jobStoreRedis.createJob(baseInput);
    const running = await jobStoreRedis.createJob(baseInput);
    const failed = await jobStoreRedis.createJob(baseInput);
    createdJobIds.push(queued.id, running.id, failed.id);

    await jobStoreRedis.setRunning(running.id, { phase: "running", pct: 10 });
    await jobStoreRedis.setFailed(failed.id, { message: "boom" });

    await getRedis().set(`evb:${instanceId}:job:${running.id}:lease`, "worker-x", "PX", 5000);
    const res = await fetch(`${serverUrl}/v1/admin/jobs?status=running&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ jobId: string; leaseOk: boolean }> };
    const jobIds = body.items.map((item) => item.jobId);
    expect(jobIds).toContain(running.id);
    const entry = body.items.find((item) => item.jobId === running.id);
    expect(entry?.leaseOk).toBe(true);

    const detailRes = await fetch(`${serverUrl}/v1/admin/jobs/${running.id}/events`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as { events?: Array<{ type: string }> };
    expect(Array.isArray(detail.events)).toBe(true);
  });

  it("requeues running jobs without lease", async () => {
    const running = await jobStoreRedis.createJob(baseInput);
    createdJobIds.push(running.id);
    await jobStoreRedis.setRunning(running.id, { phase: "running", pct: 10 });
    await getRedis().del(`evb:${instanceId}:job:${running.id}:lease`);

    const res = await fetch(`${serverUrl}/v1/admin/recover`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      requeued: number;
      failed: number;
      scanned: number;
      skipped: number;
    };
    expect(body.requeued).toBe(1);
    expect(body.failed).toBe(0);

    const job = await jobStoreRedis.getJob(running.id);
    expect(job?.status).toBe("queued");
    expect((job?.retryCount ?? 0) >= 1).toBe(true);

    const eventsRes = await fetch(`${serverUrl}/v1/admin/jobs/${running.id}/events`);
    expect(eventsRes.status).toBe(200);
    const eventsBody = (await eventsRes.json()) as { events: Array<{ type: string }> };
    const types = eventsBody.events.map((event) => event.type);
    expect(types).toContain("requeued");
  });

  it("records events for a successful job", async () => {
    const manifest = {
      manifestVersion: "0.1",
      courseTitle: "Admin Events Test",
      approvedAt: new Date().toISOString(),
      draftSignature: "sig",
      sections: [{ id: "s1", title: "Intro", script: "Hello world." }]
    };
    const settings = {
      outputMode: "avatar_only",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1,
      updatedAt: new Date().toISOString()
    };
    const createRes = await fetch(`${serverUrl}/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "p1", manifest, settings })
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { jobId: string };
    createdJobIds.push(createBody.jobId);

    let done = false;
    for (let i = 0; i < 40; i += 1) {
      const jobRes = await fetch(`${serverUrl}/v1/jobs/${createBody.jobId}`);
      const jobBody = await jobRes.json();
      if (jobBody.status === "succeeded") {
        done = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(done).toBe(true);

    const eventsRes = await fetch(`${serverUrl}/v1/admin/jobs/${createBody.jobId}/events`);
    expect(eventsRes.status).toBe(200);
    const eventsBody = (await eventsRes.json()) as { events: Array<{ type: string }> };
    const types = eventsBody.events.map((event) => event.type);
    expect(types).toContain("accepted");
    expect(types).toContain("queued");
    expect(types).toContain("lease_acquired");
    expect(types).toContain("running");
    expect(types).toContain("artifacts_written");
    expect(types).toContain("succeeded");
  });
});
