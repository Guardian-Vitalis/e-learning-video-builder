import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueueBackend, getRunMode, getStoreBackend, isRedisEnabled } from "./config";

describe("config", () => {
  const originalEnv = { ...process.env };

  const loadConfig = async () => {
    vi.resetModules();
    return import("./config");
  };

  const restoreEnv = () => {
    process.env = { ...originalEnv };
  };

  afterEach(() => {
    restoreEnv();
  });

  it("defaults to solo/memory when no redis flags are set", async () => {
    delete process.env.EVB_RUN_MODE;
    delete process.env.EVB_STORE;
    delete process.env.EVB_QUEUE;
    const config = await loadConfig();
    expect(config.getRunMode()).toBe("solo");
    expect(config.getStoreBackend()).toBe("memory");
    expect(config.getQueueBackend()).toBe("memory");
    expect(config.isRedisEnabled()).toBe(false);
  });

  it("forces memory backends in solo mode even when REDIS_URL is set", async () => {
    process.env.EVB_RUN_MODE = "solo";
    process.env.REDIS_URL = "redis://localhost:6379";
    const config = await loadConfig();
    expect(config.getRunMode()).toBe("solo");
    expect(config.isRedisEnabled()).toBe(false);
    expect(config.getStoreBackend()).toBe("memory");
    expect(config.getQueueBackend()).toBe("memory");
  });

  it("uses redis backends when run mode is split", async () => {
    process.env.EVB_RUN_MODE = "split";
    process.env.REDIS_URL = "redis://localhost:6379";
    const config = await loadConfig();
    expect(config.getRunMode()).toBe("split");
    expect(config.getStoreBackend()).toBe("redis");
    expect(config.getQueueBackend()).toBe("redis");
    expect(config.isRedisEnabled()).toBe(true);
  });
});
