import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createLocalAvatarClient,
  LocalAvatarJobSubmit
} from "./localAvatarClient";
import { SAMPLE_MP4_BASE64 } from "./__fixtures__/sampleMp4Base64";

type ServerHandle = {
  url: string;
  close: () => Promise<void>;
};

async function startServer(
  handler: Parameters<typeof createServer>[0]
): Promise<ServerHandle> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

describe("localAvatarClient", () => {
  let tempDir = "";

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-local-avatar-"));
  });

  afterAll(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("submits jobs, polls status, and fetches artifacts", async () => {
    const server = await startServer((req, res) => {
      if (req.url === "/health") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, name: "musetalk" }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/jobs") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ accepted: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/jobs/job-1/clip-1/status") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "succeeded" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/jobs/job-1/clip-1/artifacts") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ mp4Base64: SAMPLE_MP4_BASE64, durationMs: 1200 }));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    const client = createLocalAvatarClient({
      baseUrl: server.url,
      timeoutMs: 2000
    });

    const health = await client.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.name).toBe("musetalk");

    const payload: LocalAvatarJobSubmit = {
      jobId: "job-1",
      clipId: "clip-1",
      imagePngBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AApMBgB2Zt9QAAAAASUVORK5CYII=",
      width: 640,
      height: 360,
      fps: 30,
      scriptText: "Hello"
    };
    const accepted = await client.submitClipJob(payload);
    expect(accepted.accepted).toBe(true);

    const status = await client.pollClipStatus("job-1", "clip-1");
    expect(status.status).toBe("succeeded");

    const artifacts = await client.fetchClipArtifacts("job-1", "clip-1");
    const outputPath = path.join(tempDir, "clip.mp4");
    await fs.writeFile(outputPath, Buffer.from(artifacts.mp4Base64, "base64"));
    const buffer = await fs.readFile(outputPath);
    expect(buffer.length).toBeGreaterThan(0);

    await server.close();
  });

  it("passes through cache metadata from status polling", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/jobs/job-4/clip-4/status") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: "succeeded", cacheHit: true, prepKey: "prep-123" }));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    const client = createLocalAvatarClient({ baseUrl: server.url, timeoutMs: 2000 });
    const status = await client.pollClipStatus("job-4", "clip-4");
    expect(status.status).toBe("succeeded");
    expect(status.cacheHit).toBe(true);
    expect(status.prepKey).toBe("prep-123");

    await server.close();
  });

  it("includes optional fields when provided", async () => {
    let bodyText = "";
    const server = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/jobs") {
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => {
          bodyText = raw;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ accepted: true }));
        });
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });

    const client = createLocalAvatarClient({
      baseUrl: server.url,
      timeoutMs: 2000
    });

    await client.submitClipJob({
      jobId: "job-2",
      clipId: "clip-2",
      imagePngBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AApMBgB2Zt9QAAAAASUVORK5CYII=",
      width: 640,
      height: 360,
      avatarId: "avatar-1",
      bboxShift: 0.2,
      preparationHint: "prefer_cached",
      fps: 25
    });

    const parsed = JSON.parse(bodyText);
    expect(parsed.avatarId).toBe("avatar-1");
    expect(parsed.bboxShift).toBe(0.2);
    expect(parsed.preparationHint).toBe("prefer_cached");
    expect(parsed.fps).toBe(25);

    await server.close();
  });

  it("returns HTTP_NON_2XX without JSON parsing", async () => {
    const server = await startServer((_req, res) => {
      res.statusCode = 500;
      res.end("engine failed");
    });
    const client = createLocalAvatarClient({ baseUrl: server.url, timeoutMs: 2000 });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: "HTTP_NON_2XX",
      status: 500
    });

    await server.close();
  });

  it("returns INVALID_JSON on parse errors", async () => {
    const server = await startServer((req, res) => {
      if (req.url === "/health") {
        res.statusCode = 200;
        res.end("not json");
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    const client = createLocalAvatarClient({ baseUrl: server.url, timeoutMs: 2000 });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: "INVALID_JSON"
    });

    await server.close();
  });

  it("returns INVALID_SCHEMA for missing fields", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/jobs") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ accepted: false }));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    const client = createLocalAvatarClient({ baseUrl: server.url, timeoutMs: 2000 });

    await expect(
      client.submitClipJob({
        jobId: "job-2",
        clipId: "clip-2",
        imagePngBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AApMBgB2Zt9QAAAAASUVORK5CYII=",
        width: 640,
        height: 360
      })
    ).rejects.toMatchObject({
      code: "INVALID_SCHEMA"
    });

    await server.close();
  });

  it("validates mp4Base64 exists and is non-empty", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/jobs/job-3/clip-3/artifacts") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ durationMs: 1000 }));
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    const client = createLocalAvatarClient({ baseUrl: server.url, timeoutMs: 2000 });

    await expect(client.fetchClipArtifacts("job-3", "clip-3")).rejects.toMatchObject({
      code: "INVALID_SCHEMA"
    });

    await server.close();
  });

  it("returns TIMEOUT when request exceeds timeout", async () => {
    const server = await startServer((_req, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, name: "musetalk" }));
      }, 100);
    });
    const client = createLocalAvatarClient({ baseUrl: server.url, timeoutMs: 10 });

    await expect(client.healthCheck()).rejects.toMatchObject({
      code: "TIMEOUT"
    });

    await server.close();
  });
});
