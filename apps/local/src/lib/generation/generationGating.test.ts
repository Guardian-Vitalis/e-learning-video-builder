import { describe, expect, it } from "vitest";
import type { DraftManifest } from "@evb/shared";
import { buildGenerationInputFromDraft } from "./generationGating";

const baseManifest: DraftManifest = {
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
      level: 2,
      selected: true,
      script: "three",
      mediaRefs: []
    }
  ]
};

describe("generation gating", () => {
  it("filters generation input using enabled map", () => {
    const input = buildGenerationInputFromDraft(baseManifest, ["B"]);

    expect(input.selectedSectionIds).toEqual(["A", "C"]);
    expect(input.sourceDoc.sections).toEqual([
      {
        sectionId: "A",
        level: 1,
        heading: "Alpha",
        text: "one"
      },
      {
        sectionId: "C",
        level: 2,
        heading: "Gamma",
        text: "three"
      }
    ]);
  });

  it("defaults to all sections when no disabled list provided", () => {
    const manifest: DraftManifest = {
      ...baseManifest,
      sections: [
        { ...baseManifest.sections[0], selected: false },
        { ...baseManifest.sections[1], selected: true },
        { ...baseManifest.sections[2], selected: true }
      ]
    };
    const input = buildGenerationInputFromDraft(manifest);

    expect(input.selectedSectionIds).toEqual(["A", "B", "C"]);
  });

  it("builds generation input with overlays and preserves order", () => {
    const input = buildGenerationInputFromDraft(baseManifest, ["B"], {
      A: "edited one",
      C: "edited three"
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
        level: 2,
        heading: "Gamma",
        text: "edited three"
      }
    ]);
  });
});
