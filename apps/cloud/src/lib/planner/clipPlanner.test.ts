import { describe, expect, it } from "vitest";
import {
  generateVariations,
  groupSentences,
  planSectionClips,
  splitIntoSentences
} from "./clipPlanner";

describe("clipPlanner", () => {
  it("splits and groups sentences", () => {
    const sentences = splitIntoSentences("One. Two? Three!");
    expect(sentences).toEqual(["One.", "Two?", "Three!"]);
    const grouped = groupSentences(sentences, 2);
    expect(grouped).toEqual(["One. Two?", "Three!"]);
  });

  it("generates deterministic variations", () => {
    const text = "We explain the overview. It is important to learn.";
    const first = generateVariations(text, 3, "seed-1");
    const second = generateVariations(text, 3, "seed-1");
    expect(first).toEqual(second);
    expect(first[0]).toBe(text);
    expect(first.length).toBe(3);
  });

  it("plans clips per variation", () => {
    const plan = planSectionClips({
      sectionId: "s1",
      sourceText: "One. Two. Three. Four.",
      sentencesPerClip: 2,
      variationsPerSection: 2,
      seedKey: "seed"
    });
    expect(plan.variations.length).toBe(2);
    expect(plan.variations[0].clips.length).toBe(2);
    expect(plan.variations[0].clips[0].text).toBe("One. Two.");
  });
});
