import { describe, expect, it } from "vitest";
import { getArtifactTimestamp } from "./getArtifactTimestamp";

describe("getArtifactTimestamp", () => {
  it("prefers jobUpdatedAt when valid", () => {
    const result = getArtifactTimestamp({
      jobUpdatedAt: "2024-01-02T00:00:00.000Z",
      fetchedAt: "2024-01-01T00:00:00.000Z"
    });

    expect(result).toBe("2024-01-02T00:00:00.000Z");
  });

  it("falls back to fetchedAt when jobUpdatedAt is invalid", () => {
    const result = getArtifactTimestamp({
      jobUpdatedAt: "not-a-date",
      fetchedAt: "2024-01-01T00:00:00.000Z"
    });

    expect(result).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns null when neither timestamp is valid", () => {
    const result = getArtifactTimestamp({ jobUpdatedAt: "nope", fetchedAt: undefined });

    expect(result).toBeNull();
  });
});
