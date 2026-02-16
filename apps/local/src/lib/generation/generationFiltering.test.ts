import { describe, expect, it } from "vitest";
import type { DraftManifest } from "@evb/shared";
import { filterDraftManifestSections } from "./generationFiltering";

const manifest: DraftManifest = {
  manifestVersion: "0.1",
  courseTitle: "Course",
  sections: [
    { id: "s1", title: "First", level: 1, selected: true, script: "one", mediaRefs: [] },
    { id: "s2", title: "Second", level: 2, selected: true, script: "two", mediaRefs: [] },
    { id: "s3", title: "Third", level: 2, selected: true, script: "three", mediaRefs: [] }
  ]
};

describe("generation filtering", () => {
  it("keeps ordering while excluding disabled ids", () => {
    const result = filterDraftManifestSections(manifest, ["s2"]);
    expect(result.map((section) => section.id)).toEqual(["s1", "s3"]);
  });

  it("returns shallow copy when no disabled ids", () => {
    const result = filterDraftManifestSections(manifest);
    expect(result).not.toBe(manifest.sections);
    expect(result.map((section) => section.id)).toEqual(["s1", "s2", "s3"]);
  });
});
