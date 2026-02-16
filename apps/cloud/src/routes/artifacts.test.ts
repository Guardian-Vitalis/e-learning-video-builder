import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { createArtifactToken } from "../lib/artifactTokens";
import { createArtifactsRouter } from "./artifacts";

describe("artifacts route", () => {
  const originalSecret = process.env.ARTIFACT_TOKEN_SECRET;
  let artifactsDir = "";
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.ARTIFACT_TOKEN_SECRET = "test-secret";
    artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-artifacts-"));
    const app = express();
    app.use("/v1/artifacts", createArtifactsRouter({ artifactsDir }));
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      });
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
    if (artifactsDir) {
      await fs.rm(artifactsDir, { recursive: true, force: true });
    }
    process.env.ARTIFACT_TOKEN_SECRET = originalSecret;
  });

  it("streams artifacts with correct content type", async () => {
    const relPath = "jobs/j1/out.mp4";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.alloc(2048, 1));

    const { token } = createArtifactToken("job-1", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });
    const res = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("video/mp4");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(2048);
  });

  it("returns 410 for expired tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const relPath = "jobs/j2/captions.vtt";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, "WEBVTT");

    const { token } = createArtifactToken("job-2", {
      secret: "test-secret",
      ttlSeconds: 1,
      path: relPath
    });
    vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));
    const res = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`);
    expect(res.status).toBe(410);
    vi.useRealTimers();
  });

  it("returns 403 when token path does not match request", async () => {
    const relPath = "jobs/j3/out.mp4";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, "1");

    const { token } = createArtifactToken("job-3", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });
    const res = await fetch(
      `${serverUrl}/v1/artifacts/${token}/jobs/j3/out.vtt`
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 when file is missing", async () => {
    const relPath = "jobs/j4/missing.mp4";
    const { token } = createArtifactToken("job-4", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });
    const res = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`);
    expect(res.status).toBe(404);
  });

  it("returns correct content type for vtt and srt", async () => {
    const vttPath = "jobs/j5/captions.vtt";
    const srtPath = "jobs/j5/captions.srt";
    await fs.mkdir(path.join(artifactsDir, "jobs/j5"), { recursive: true });
    await fs.writeFile(path.join(artifactsDir, vttPath), "WEBVTT");
    await fs.writeFile(path.join(artifactsDir, srtPath), "1");

    const vttToken = createArtifactToken("job-5", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: vttPath
    }).token;
    const srtToken = createArtifactToken("job-5", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: srtPath
    }).token;

    const vttRes = await fetch(`${serverUrl}/v1/artifacts/${vttToken}/${vttPath}`);
    expect(vttRes.status).toBe(200);
    expect(vttRes.headers.get("content-type")).toContain("text/vtt");

    const srtRes = await fetch(`${serverUrl}/v1/artifacts/${srtToken}/${srtPath}`);
    expect(srtRes.status).toBe(200);
    expect(srtRes.headers.get("content-type")).toContain("application/x-subrip");
  });

  it("supports range requests for mp4", async () => {
    const relPath = "jobs/j6/out.mp4";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.alloc(4096, 2));

    const { token } = createArtifactToken("job-6", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });

    const rangeRes = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`, {
      headers: { Range: "bytes=0-999" }
    });
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("accept-ranges")).toBe("bytes");
    expect(rangeRes.headers.get("content-range")).toMatch(/^bytes 0-999\/4096$/);
    expect(rangeRes.headers.get("content-length")).toBe("1000");
    const rangeBody = await rangeRes.arrayBuffer();
    expect(rangeBody.byteLength).toBe(1000);
  });

  it("supports open-ended and suffix mp4 ranges", async () => {
    const relPath = "jobs/j8/out.mp4";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.alloc(2000, 4));

    const { token } = createArtifactToken("job-8", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });

    const openZeroRes = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`, {
      headers: { Range: "bytes=0-" }
    });
    expect(openZeroRes.status).toBe(206);
    expect(openZeroRes.headers.get("content-range")).toMatch(/^bytes 0-1999\/2000$/);
    expect(openZeroRes.headers.get("content-length")).toBe("2000");

    const openRes = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`, {
      headers: { Range: "bytes=1000-" }
    });
    expect(openRes.status).toBe(206);
    expect(openRes.headers.get("content-range")).toMatch(/^bytes 1000-1999\/2000$/);
    expect(openRes.headers.get("content-length")).toBe("1000");

    const suffixRes = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`, {
      headers: { Range: "bytes=-500" }
    });
    expect(suffixRes.status).toBe(206);
    expect(suffixRes.headers.get("content-range")).toMatch(/^bytes 1500-1999\/2000$/);
    expect(suffixRes.headers.get("content-length")).toBe("500");
  });

  it("supports HEAD for mp4 ranges", async () => {
    const relPath = "jobs/j9/out.mp4";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.alloc(3000, 5));

    const { token } = createArtifactToken("job-9", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });

    const headRes = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`, {
      method: "HEAD",
      headers: { Range: "bytes=0-999" }
    });
    expect(headRes.status).toBe(206);
    expect(headRes.headers.get("content-range")).toMatch(/^bytes 0-999\/3000$/);
    expect(headRes.headers.get("content-length")).toBe("1000");
  });

  it("returns 416 for invalid mp4 ranges", async () => {
    const relPath = "jobs/j7/out.mp4";
    const fullPath = path.join(artifactsDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.alloc(1024, 3));

    const { token } = createArtifactToken("job-7", {
      secret: "test-secret",
      ttlSeconds: 60,
      path: relPath
    });

    const rangeRes = await fetch(`${serverUrl}/v1/artifacts/${token}/${relPath}`, {
      headers: { Range: "bytes=9999-10000" }
    });
    expect(rangeRes.status).toBe(416);
    expect(rangeRes.headers.get("content-range")).toBe("bytes */1024");
  });
});
