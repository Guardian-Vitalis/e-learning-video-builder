import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { isHeartbeatFresh, workerRouter } from "./worker";
import { writeHeartbeat } from "../worker/heartbeat";

describe("isHeartbeatFresh", () => {
  it("marks recent heartbeat as ok", () => {
    const now = Date.parse("2024-01-01T00:00:10Z");
    const lastSeen = Date.parse("2024-01-01T00:00:00Z");
    const result = isHeartbeatFresh(lastSeen, now, 20);
    expect(result.ok).toBe(true);
    expect(result.ageSeconds).toBe(10);
  });

  it("marks stale heartbeat as not ok", () => {
    const now = Date.parse("2024-01-01T00:00:30Z");
    const lastSeen = Date.parse("2024-01-01T00:00:00Z");
    const result = isHeartbeatFresh(lastSeen, now, 20);
    expect(result.ok).toBe(false);
    expect(result.ageSeconds).toBe(30);
  });

  it("rejects invalid heartbeat timestamps", () => {
    const result = isHeartbeatFresh(Number.NaN, Date.now(), 20);
    expect(result.ok).toBe(false);
    expect(result.ageSeconds).toBeNull();
  });
});

describe("worker heartbeat route (solo)", () => {
  const originalEnv = { ...process.env };
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.EVB_RUN_MODE = "solo";
    const app = express();
    app.use("/v1", workerRouter);
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
    process.env = originalEnv;
  });

  it("returns ok when heartbeat is fresh", async () => {
    const now = Date.now();
    await writeHeartbeat({
      ok: true,
      instanceId: "local",
      mode: "solo",
      queue: "memory",
      store: "memory",
      provider: "stub",
      lastBeatMs: now,
      nowMs: now
    });
    const res = await fetch(`${serverUrl}/v1/worker/heartbeat`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      lastBeatMs?: number;
      nowMs?: number;
      provider?: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.lastBeatMs).toBe("number");
    expect(typeof body.nowMs).toBe("number");
    expect(body.provider).toBe("stub");
  });
});
