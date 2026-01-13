import { describe, expect, it } from "vitest";
import type { DraftSection } from "@evb/shared";
import { buildOutlineView } from "./outlineSelectors";
import { filterOutlineNodes } from "./outlineFilter";

const sections: DraftSection[] = [
  { id: "A", title: "Alpha", level: 1, selected: true, script: "one", mediaRefs: [] },
  { id: "A1", title: "Alpha One", level: 2, selected: true, script: "one-a", mediaRefs: [] },
  { id: "A2", title: "Alpha Two", level: 2, selected: true, script: "one-b", mediaRefs: [] },
  { id: "B", title: "Beta", level: 1, selected: true, script: "two", mediaRefs: [] }
];

describe("outlineSelectors", () => {
  it("preserves deterministic IDs and ordering in the flattened view", () => {
    const { nodes, parentMap } = buildOutlineView(sections, new Set());

    expect(nodes.map((node) => node.id)).toEqual(["A", "A1", "A2", "B"]);
    expect(parentMap.get("A")).toBeUndefined();
    expect(parentMap.get("A1")).toBe("A");
    expect(parentMap.get("A2")).toBe("A");
    expect(parentMap.get("B")).toBeUndefined();
  });

  it("hides descendants when a parent is collapsed", () => {
    const { nodes, parentMap } = buildOutlineView(sections, new Set(["A"]));
    const result = filterOutlineNodes({
      nodes,
      sections,
      filter: { query: "", selectedOnly: false },
      parentMap
    });

    expect(result.visible.map((node) => node.id)).toEqual(["A", "B"]);
  });
});
