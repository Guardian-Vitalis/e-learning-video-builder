import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { adminRouter } from "./admin";

describe("admin routes (non-redis)", () => {
  const originalEnv = { ...process.env };
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.EVB_RUN_MODE = "solo";
    delete process.env.EVB_STORE;
    delete process.env.EVB_QUEUE;
    const app = express();
    app.use("/v1", adminRouter);
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

  it("returns 400 when redis mode is disabled", async () => {
    const jobsRes = await fetch(`${serverUrl}/v1/admin/jobs`);
    expect(jobsRes.status).toBe(400);
    const jobsBody = await jobsRes.json();
    expect(jobsBody.error).toBe("admin_requires_redis_mode");

    const eventsRes = await fetch(`${serverUrl}/v1/admin/jobs/does-not-exist/events`);
    expect(eventsRes.status).toBe(400);
    const eventsBody = await eventsRes.json();
    expect(eventsBody.error).toBe("admin_requires_redis_mode");

    const recoverRes = await fetch(`${serverUrl}/v1/admin/recover`, { method: "POST" });
    expect(recoverRes.status).toBe(400);
    const recoverBody = await recoverRes.json();
    expect(recoverBody.error).toBe("admin_requires_redis_mode");
  });
});
