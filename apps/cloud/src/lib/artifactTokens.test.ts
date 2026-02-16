import { describe, expect, it, vi } from "vitest";
import { createArtifactToken, validateArtifactToken } from "./artifactTokens";

describe("artifactTokens", () => {
  it("valid token passes validation", () => {
    const { token } = createArtifactToken("job-123", {
      secret: "test-secret",
      ttlSeconds: 60
    });
    const result = validateArtifactToken(token, "job-123", { secret: "test-secret" });
    expect(result.ok).toBe(true);
    expect(result.expired).toBe(false);
  });

  it("expired token is rejected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const { token } = createArtifactToken("job-456", {
      secret: "test-secret",
      ttlSeconds: 1
    });
    vi.setSystemTime(new Date("2024-01-01T00:00:02Z"));
    const result = validateArtifactToken(token, "job-456", { secret: "test-secret" });
    expect(result.ok).toBe(false);
    expect(result.expired).toBe(true);
    vi.useRealTimers();
  });

  it("rejects unsafe paths", () => {
    expect(() =>
      createArtifactToken("job-789", {
        secret: "test-secret",
        ttlSeconds: 60,
        path: "../secret.txt"
      })
    ).toThrow("Unsafe artifact path.");
  });
});
