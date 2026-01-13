import { afterEach, describe, expect, it, vi } from "vitest";

const DEFAULT_MAX = 300 * 1024 * 1024;
const DEFAULT_WARN = 120 * 1024 * 1024;

describe("config", () => {
  const originalEnv = { ...process.env };

  const loadConfig = async () => {
    vi.resetModules();
    return import("./config");
  };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses defaults when env is missing", async () => {
    delete process.env.NEXT_PUBLIC_EVB_MAX_DOCX_MB;
    delete process.env.NEXT_PUBLIC_EVB_WARN_DOCX_MB;
    delete process.env.MAX_DOCX_BYTES;
    delete process.env.NEXT_PUBLIC_MAX_DOCX_BYTES;
    delete process.env.LARGE_DOCX_WARN_BYTES;
    delete process.env.NEXT_PUBLIC_LARGE_DOCX_WARN_BYTES;

    const config = await loadConfig();
    expect(config.MAX_DOCX_BYTES).toBe(DEFAULT_MAX);
    expect(config.LARGE_DOCX_WARN_BYTES).toBe(DEFAULT_WARN);

  });

  it("uses env overrides when provided", async () => {
    process.env.MAX_DOCX_BYTES = String(350 * 1024 * 1024);
    process.env.LARGE_DOCX_WARN_BYTES = String(140 * 1024 * 1024);
    process.env.NEXT_PUBLIC_EVB_MAX_DOCX_MB = "300";
    process.env.NEXT_PUBLIC_EVB_WARN_DOCX_MB = "120";

    const config = await loadConfig();
    expect(config.MAX_DOCX_BYTES).toBe(350 * 1024 * 1024);
    expect(config.LARGE_DOCX_WARN_BYTES).toBe(140 * 1024 * 1024);

  });

  it("falls back to defaults for invalid env values", async () => {
    process.env.MAX_DOCX_BYTES = "not-a-number";
    process.env.LARGE_DOCX_WARN_BYTES = "-5";
    process.env.NEXT_PUBLIC_EVB_MAX_DOCX_MB = "not-a-number";
    process.env.NEXT_PUBLIC_EVB_WARN_DOCX_MB = "-5";

    const config = await loadConfig();
    expect(config.MAX_DOCX_BYTES).toBe(DEFAULT_MAX);
    expect(config.LARGE_DOCX_WARN_BYTES).toBe(DEFAULT_WARN);

  });
});
