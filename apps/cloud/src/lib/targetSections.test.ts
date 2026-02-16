import { describe, expect, it } from "vitest";
import { filterSectionsByTargetIds } from "./targetSections";

describe("filterSectionsByTargetIds", () => {
  it("returns only targeted sections", () => {
    const sections = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const result = filterSectionsByTargetIds(sections, ["B"]);

    expect(result.map((section) => section.id)).toEqual(["B"]);
  });

  it("keeps original order for targeted sections", () => {
    const sections = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const result = filterSectionsByTargetIds(sections, ["C", "A"]);

    expect(result.map((section) => section.id)).toEqual(["A", "C"]);
  });

  it("returns all sections when no targets provided", () => {
    const sections = [{ id: "A" }, { id: "B" }];
    const result = filterSectionsByTargetIds(sections);

    expect(result).toEqual(sections);
  });
});
