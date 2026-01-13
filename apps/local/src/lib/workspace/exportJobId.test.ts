import { describe, expect, it } from "vitest";
import { getExportJobIdFromHistory } from "./exportJobId";
import type { ProjectGenerationHistoryItem } from "@evb/shared";

describe("getExportJobIdFromHistory", () => {
  it("uses the selected preview job when it succeeded", () => {
    const history: ProjectGenerationHistoryItem[] = [
      { jobId: "a1", status: "succeeded", createdAt: "t1" },
      { jobId: "b2", status: "succeeded", createdAt: "t2" }
    ];
    expect(getExportJobIdFromHistory(history, "b2")).toBe("b2");
  });

  it("falls back to the newest succeeded job when selection is missing", () => {
    const history: ProjectGenerationHistoryItem[] = [
      { jobId: "a1", status: "succeeded", createdAt: "t1" },
      { jobId: "b2", status: "failed", createdAt: "t2" }
    ];
    expect(getExportJobIdFromHistory(history, "missing")).toBe("a1");
  });

  it("returns null when no succeeded jobs exist", () => {
    const history: ProjectGenerationHistoryItem[] = [
      { jobId: "c3", status: "failed", createdAt: "t3" }
    ];
    expect(getExportJobIdFromHistory(history, null)).toBeNull();
  });
});
