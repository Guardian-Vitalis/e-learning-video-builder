import { describe, expect, it } from "vitest";
import {
  getEffectiveScriptForNode,
  updateScriptEditsForNode
} from "./effectiveScript";

describe("effective script helper", () => {
  it("prefers scripted edits when available", () => {
    const result = getEffectiveScriptForNode({
      nodeId: "s1",
      baseScript: "Original",
      scriptEditsByNodeId: { s1: "Edited" }
    });
    expect(result).toBe("Edited");
  });

  it("falls back to base script when no edits", () => {
    const result = getEffectiveScriptForNode({
      nodeId: "s2",
      baseScript: "Original",
      scriptEditsByNodeId: { s1: "Edited" }
    });
    expect(result).toBe("Original");
  });

  it("removes entry when script matches base after trimming", () => {
    const edited = updateScriptEditsForNode({
      nodeId: "s1",
      baseScript: "  Hello world  ",
      scriptText: "Hello world",
      scriptEditsByNodeId: { s1: "Existing" }
    });
    expect(edited).toBeUndefined();
  });

  it("stores script when different from base", () => {
    const edited = updateScriptEditsForNode({
      nodeId: "s1",
      baseScript: "Hello",
      scriptText: "Hello again",
      scriptEditsByNodeId: {}
    });
    expect(edited).toEqual({ s1: "Hello again" });
  });
});
