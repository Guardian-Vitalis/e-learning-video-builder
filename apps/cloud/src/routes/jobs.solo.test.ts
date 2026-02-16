import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../index";
import { startWorker } from "../worker/runWorker";
import type { Server } from "node:http";

const HOOK_TIMEOUT = 30_000;
const TEST_TIMEOUT = 30_000;
const FETCH_TIMEOUT = 5_000;
const POLL_DEADLINE = 20_000;

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

const fetchBuffer = async (url: string, init: RequestInit = {}) => {
  const res = await fetchWithTimeout(url, init, FETCH_TIMEOUT);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Request failed (${res.status}) for ${url}${text ? `: ${text}` : ""}`
    );
  }
  return Buffer.from(await res.arrayBuffer());
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

describe("jobs solo flow", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let workerController: AbortController | null = null;
  let workerPromise: Promise<void> | null = null;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.EVB_RUN_MODE = "solo";
    process.env.EVB_DISABLE_FFMPEG = "1";
    process.env.AVATAR_PROVIDER = "bad";
    process.env.REDIS_URL = "";
    process.env.NODE_ENV = "test";

    const app = createApp();
    const listener = app.listen(0);
    server = listener;
    const address = listener.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to bind test server");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    workerController = new AbortController();
    workerPromise = startWorker({ signal: workerController.signal, jobTimeoutMs: 20000 });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      if (workerController) {
        workerController.abort();
      }
      if (workerPromise) {
        try {
          await withTimeout(workerPromise, 5000, "worker shutdown");
        } catch (err) {
          console.warn(`[test] worker shutdown timeout: ${String(err)}`);
        }
      }
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
    } finally {
      process.env = originalEnv;
    }
  }, HOOK_TIMEOUT);

  it("creates a job and produces mp4 + captions", async () => {
    const manifest = {
      manifestVersion: "0.1",
      courseTitle: "Solo Test",
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
    let lastStatus = "unknown";
    let lastBody = "";
    let attempt = 0;
    const start = Date.now();
    while (Date.now() - start < POLL_DEADLINE) {
      attempt += 1;
      job = await fetchJson(`${baseUrl}/v1/jobs/${jobId}`);
      lastStatus = job.status ?? "unknown";
      lastBody = JSON.stringify(job);
      console.log(`[test] poll status=${lastStatus} attempt=${attempt}`);
      if (job.status === "succeeded") {
        break;
      }
      if (job.status === "failed") {
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

    const srtText = await fetchText(`${baseUrl}${job.artifacts.srtPath}`);
    expect(srtText.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("rejects job creation without an approved manifest", async () => {
    const settings = {
      outputMode: "avatar_only",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1,
      updatedAt: new Date().toISOString()
    };
    const body = {
      projectId: "p2",
      sourceDoc: {
        title: "Unapproved",
        sections: [
          { sectionId: "s1", level: 1, heading: "Intro", text: "Hello world." }
        ]
      },
      settings
    };

    const res = await fetchWithTimeout(`${baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("approval_required");
  }, TEST_TIMEOUT);
});
