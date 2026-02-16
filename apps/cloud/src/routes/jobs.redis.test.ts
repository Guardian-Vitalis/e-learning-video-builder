import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { getRedis } from "../redis/client";

const HOOK_TIMEOUT = 30_000;
const TEST_TIMEOUT = 30_000;
const FETCH_TIMEOUT = 5_000;
const POLL_DEADLINE = 20_000;

const SHOULD_RUN =
  process.env.EVB_RUN_REDIS_TESTS === "1" && Boolean(process.env.REDIS_URL);

if (!SHOULD_RUN) {
  console.log(
    "[test] Skipping Redis tests. Set EVB_RUN_REDIS_TESTS=1 and REDIS_URL to enable."
  );
}

const suite = SHOULD_RUN ? describe : describe.skip;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchJson = async (url: string, init: RequestInit = {}) => {
  const res = await fetchWithTimeout(url, init, FETCH_TIMEOUT);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for ${url}${text ? `: ${text}` : ""}`
    );
  }
  return text ? JSON.parse(text) : {};
};

const fetchText = async (url: string, init: RequestInit = {}) => {
  const res = await fetchWithTimeout(url, init, FETCH_TIMEOUT);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Request failed (${res.status}) for ${url}${text ? `: ${text}` : ""}`
    );
  }
  return text;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

suite("jobs redis flow", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let instanceId = "";
  const originalEnv = { ...process.env };

  const startTestWorker = async (crashAfterRunning = false) => {
    const { startWorker } = await import("../worker/runWorker");
    const controller = new AbortController();
    if (crashAfterRunning) {
      process.env.EVB_TEST_CRASH_AFTER_RUNNING = "1";
    } else {
      delete process.env.EVB_TEST_CRASH_AFTER_RUNNING;
    }
    const promise = startWorker({ signal: controller.signal, jobTimeoutMs: 20000 });
    return { controller, promise };
  };

  beforeAll(async () => {
    instanceId = `redis-${randomUUID()}`;
    process.env.EVB_RUN_MODE = "split";
    process.env.EVB_STORE = "redis";
    process.env.EVB_QUEUE = "redis";
    process.env.EVB_INSTANCE_ID = instanceId;
    process.env.EVB_DISABLE_FFMPEG = "1";
    process.env.AVATAR_PROVIDER = "stub";
    process.env.NODE_ENV = "test";

    const { createApp } = await import("../index");
    const app = createApp();
    const listener = app.listen(0);
    server = listener;
    const address = listener.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to bind test server");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      if (server) {
        try {
          await withTimeout(
            new Promise<void>((resolve) => server?.close(() => resolve())),
            5000,
            "server shutdown"
          );
        } catch (err) {
          console.warn(`[test] server shutdown timeout: ${String(err)}`);
        }
      }
      if (instanceId) {
        const redis = getRedis();
        const keys = await redis.keys(`evb:${instanceId}:*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        await redis.quit();
      }
    } finally {
      process.env = originalEnv;
    }
  }, HOOK_TIMEOUT);

  it("creates a job and produces mp4 + captions", async () => {
    const { controller, promise } = await startTestWorker();
    const manifest = {
      manifestVersion: "0.1",
      courseTitle: "Redis Test",
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

    const createBody = (await fetchJson(`${baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "p1", manifest, settings })
    })) as { jobId: string };
    const jobId = createBody.jobId;
    expect(jobId).toBeTruthy();

    let job: any = null;
    let lastBody = "";
    let attempt = 0;
    const start = Date.now();
    while (Date.now() - start < POLL_DEADLINE) {
      attempt += 1;
      job = await fetchJson(`${baseUrl}/v1/jobs/${jobId}`);
      lastBody = JSON.stringify(job);
      console.log(`[test] poll status=${job.status ?? "unknown"} attempt=${attempt}`);
      if (job.status === "succeeded" || job.status === "failed") {
        break;
      }
      await wait(500);
    }

    if (job?.status !== "succeeded") {
      throw new Error(`Job did not reach succeeded. Last response: ${lastBody}`);
    }
    expect(job?.artifacts?.mp4Path).toBeTruthy();

    const mp4Res = await fetchWithTimeout(`${baseUrl}${job.artifacts.mp4Path}`);
    expect(mp4Res.ok).toBe(true);
    const contentType = mp4Res.headers.get("content-type") ?? "";
    expect(contentType).toContain("video/mp4");
    const mp4Buffer = Buffer.from(await mp4Res.arrayBuffer());
    expect(mp4Buffer.length).toBeGreaterThanOrEqual(2048);
    expect(mp4Buffer.includes(Buffer.from("ftyp"))).toBe(true);

    const vttText = await fetchText(`${baseUrl}${job.artifacts.vttPath}`);
    expect(vttText).toContain("WEBVTT");
    expect(vttText.length).toBeGreaterThan(0);
    controller.abort();
    await withTimeout(promise, 5000, "worker shutdown");
  }, TEST_TIMEOUT);

  it("recovers a running job after worker crash", async () => {
    process.env.EVB_JOB_LEASE_MS = "1000";
    process.env.EVB_JOB_LEASE_RENEW_MS = "300";
    process.env.EVB_JOB_RECOVERY_SCAN_MS = "500";
    process.env.EVB_JOB_MAX_RETRIES = "2";

    const manifest = {
      manifestVersion: "0.1",
      courseTitle: "Redis Crash Test",
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

    const createBody = (await fetchJson(`${baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "p1", manifest, settings })
    })) as { jobId: string };
    const jobId = createBody.jobId;

    const crashing = await startTestWorker(true);
    let sawRunning = false;
    const start = Date.now();
    while (Date.now() - start < POLL_DEADLINE) {
      const job = await fetchJson(`${baseUrl}/v1/jobs/${jobId}`);
      if (job.status === "running") {
        sawRunning = true;
        break;
      }
      await wait(200);
    }
    expect(sawRunning).toBe(true);

    try {
      await withTimeout(crashing.promise, 5000, "crashing worker exit");
    } catch {
      // crash hook may stop without resolving immediately
    }

    const healthy = await startTestWorker(false);
    let finalJob: any = null;
    let lastBody = "";
    const startRecover = Date.now();
    while (Date.now() - startRecover < POLL_DEADLINE) {
      finalJob = await fetchJson(`${baseUrl}/v1/jobs/${jobId}`);
      lastBody = JSON.stringify(finalJob);
      if (finalJob.status === "succeeded" || finalJob.status === "failed") {
        break;
      }
      await wait(500);
    }
    if (finalJob?.status !== "succeeded") {
      throw new Error(`Recovered job did not succeed. Last response: ${lastBody}`);
    }
    expect((finalJob.retryCount ?? 0) >= 1).toBe(true);
    healthy.controller.abort();
    await withTimeout(healthy.promise, 5000, "worker shutdown");
  }, TEST_TIMEOUT);
});
