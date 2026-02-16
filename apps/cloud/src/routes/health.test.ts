import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { healthRouter } from "./health";

describe("health route", () => {
  const originalEnv = { ...process.env };
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.EVB_RUN_MODE = "solo";
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
    if (closeServer) {
      await closeServer();
    }
    process.env = originalEnv;
  });

  it("includes mode/store/queue in solo mode", async () => {
    const res = await fetch(`${serverUrl}/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      redisOk: boolean | null;
      mode: string;
      store: string;
      queue: string;
      worker?: { ok: boolean; lastBeatMs: number | null };
    };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("solo");
    expect(body.store).toBe("memory");
    expect(body.queue).toBe("memory");
    expect(body.redisOk).toBeNull();
    expect(body.worker).toBeDefined();
  });
});
