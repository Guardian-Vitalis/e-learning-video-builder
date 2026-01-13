import { describe, expect, it } from "vitest";
import type { DraftManifest } from "@evb/shared";
import { buildGenerationInputFromDraft } from "./generationGating";

const manifest: DraftManifest = {
  manifestVersion: "0.1",
  courseTitle: "Course",
  doc: {
    fileName: "course.docx",
    fileSize: 123,
    lastModified: 1,
    storedAt: "2024-01-01T00:00:00.000Z"
  },
  sections: [
    {
      id: "A",
      title: "Alpha",
      level: 1,
      selected: true,
      script: "one",
      mediaRefs: []
    },
    {
      id: "B",
      title: "Beta",
      level: 2,
      selected: true,
      script: "two",
      mediaRefs: []
    },
    {
      id: "C",
      title: "Gamma",
      level: 3,
      selected: true,
      script: "three",
      mediaRefs: []
    }
  ]
};

describe("generation input composition", () => {
  it("excludes disabled sections and applies script overlays in order", () => {
    const input = buildGenerationInputFromDraft(manifest, ["B"], {
      A: "edited one"
    });

    expect(input.selectedSectionIds).toEqual(["A", "C"]);
    expect(input.sourceDoc.sections).toEqual([
      {
        sectionId: "A",
        level: 1,
        heading: "Alpha",
        text: "edited one"
      },
      {
        sectionId: "C",
        level: 3,
        heading: "Gamma",
        text: "three"
      }
    ]);
  });
});
