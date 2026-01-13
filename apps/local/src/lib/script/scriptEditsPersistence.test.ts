import { describe, expect, it } from "vitest";
import { applyScriptDraftSave } from "./effectiveScript";

describe("applyScriptDraftSave", () => {
  it("adds overlay and resets approval when previously approved", () => {
    const result = applyScriptDraftSave({
      nodeId: "s1",
      baseScript: "Hello",
      scriptText: "Hello world",
      scriptEditsByNodeId: {},
      currentApprovalStatus: "approved",
      currentApprovedAt: "2024-01-01T00:00:00.000Z"
    });
    expect(result.scriptEditsByNodeId).toEqual({ s1: "Hello world" });
    expect(result.nextApprovalStatus).toBe("draft");
    expect(result.nextApprovedAt).toBeUndefined();
    expect(result.resetApproval).toBe(true);
  });

  it("removes overlay and keeps draft status when script matches base", () => {
    const result = applyScriptDraftSave({
      nodeId: "s2",
      baseScript: "Hello",
      scriptText: "Hello",
      scriptEditsByNodeId: { s2: "Hello again" },
      currentApprovalStatus: "draft",
      currentApprovedAt: undefined
    });
    expect(result.scriptEditsByNodeId).toBeUndefined();
    expect(result.nextApprovalStatus).toBe("draft");
    expect(result.resetApproval).toBe(false);
  });
});
