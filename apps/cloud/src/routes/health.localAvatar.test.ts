import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { healthRouter } from "./health";
import { startLocalAvatarEmulator } from "../worker/render/__testutils__/localAvatarEngineEmulator";

describe("health local avatar details route", () => {
  const originalEnv = { ...process.env };
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;
  let emulator: Awaited<ReturnType<typeof startLocalAvatarEmulator>> | null = null;

  beforeAll(async () => {
    const app = express();
    app.use("/v1", healthRouter);
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      });
  });

  afterAll(async () => {
    if (emulator) {
      await emulator.close();
    }
    if (closeServer) {
      await closeServer();
    }
    process.env = originalEnv;
  });

  it("returns disabled when local avatar url is missing", async () => {
    delete process.env.EVB_LOCAL_AVATAR_URL;
    const res = await fetch(`${serverUrl}/v1/health/local-avatar/details`);
    const body = (await res.json()) as { enabled: boolean; reason?: string };
    expect(body.enabled).toBe(false);
    expect(body.reason).toBe("EVB_LOCAL_AVATAR_URL not set");
  });

  it("proxies details and strips token fields", async () => {
    emulator = await startLocalAvatarEmulator({
      response: {
        ok: true,
        name: "musetalk",
        version: "test",
        token: "secret",
        ffmpeg: { found: true, version: "test", path: "ffmpeg" },
        weights: { required: [], missing: [] }
      }
    });
    process.env.EVB_LOCAL_AVATAR_URL = emulator.url;
    const res = await fetch(`${serverUrl}/v1/health/local-avatar/details`);
    const body = (await res.json()) as {
      enabled: boolean;
      reachable?: boolean;
      fetchedAt?: string;
      details?: Record<string, unknown>;
    };
    expect(body.enabled).toBe(true);
    expect(body.reachable).toBe(true);
    expect(typeof body.fetchedAt).toBe("string");
    expect(body.details?.token).toBeUndefined();
  });
});
