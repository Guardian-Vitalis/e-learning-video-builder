import { describe, expect, it } from "vitest";
import type { DraftSection } from "@evb/shared";
import { buildOutlineView } from "./outlineSelectors";
import { filterOutlineNodes } from "./outlineFilter";

const sections: DraftSection[] = [
  { id: "s1", title: "Intro", level: 1, selected: true, script: "one", mediaRefs: [] },
  { id: "s2", title: "Hidden Detail", level: 2, selected: true, script: "two", mediaRefs: [] },
  { id: "s3", title: "Wrap", level: 1, selected: true, script: "three", mediaRefs: [] }
];

describe("outlineFilter", () => {
  it("filters selected-only using enabled map", () => {
    const { nodes, parentMap } = buildOutlineView(sections, new Set());
    const result = filterOutlineNodes({
      nodes,
      sections,
      outlineDisabledIds: ["s2"],
      filter: { query: "", selectedOnly: true },
      parentMap
    });

    expect(result.visible.map((node) => node.id)).toEqual(["s1", "s3"]);
  });

  it("forces open ancestors for query matches and hides other branches", () => {
    const nested: DraftSection[] = [
      { id: "A", title: "Alpha", level: 1, selected: true, script: "one", mediaRefs: [] },
      { id: "A1", title: "Alpha One", level: 2, selected: true, script: "one-a", mediaRefs: [] },
      { id: "A2", title: "Alpha Two", level: 2, selected: true, script: "one-b", mediaRefs: [] },
      { id: "B", title: "Beta", level: 1, selected: true, script: "two", mediaRefs: [] }
    ];
    const { nodes, parentMap } = buildOutlineView(nested, new Set(["A"]));
    const result = filterOutlineNodes({
      nodes,
      sections: nested,
      filter: { query: "two", selectedOnly: false },
      parentMap
    });

    expect(result.visible.map((node) => node.id)).toEqual(["A", "A2"]);
    expect(result.forcedOpenIds.has("A")).toBe(true);
  });

  it("matches query regardless of enabled map", () => {
    const { nodes, parentMap } = buildOutlineView(sections, new Set());
    const result = filterOutlineNodes({
      nodes,
      sections,
      outlineDisabledIds: ["s2"],
      filter: { query: "hidden", selectedOnly: false },
      parentMap
    });

    expect(result.visible.map((node) => node.id)).toEqual(["s1", "s2"]);
  });
});
