import { describe, expect, it } from "vitest";
import { cleanupScript, reflowCaptionText } from "./cleanup";

describe("cleanupScript", () => {
  it("repairs split words and spacing", () => {
    const result = cleanupScript({
      text: "activat ion. H olding ( focus ) . B ecause it matters.",
      seed: "seed"
    });
    expect(result.cleanedText).toContain("activation.");
    expect(result.cleanedText).toContain("Holding (focus).");
    expect(result.cleanedText).toContain("Because it matters.");
  });

  it("expands abbreviations safely", () => {
    const result = cleanupScript({
      text: "Use e.g. examples vs. guesses, approx. values.",
      seed: "seed"
    });
    expect(result.cleanedText).toContain("for example");
    expect(result.cleanedText).toContain("versus");
    expect(result.cleanedText).toContain("approximately");
  });

  it("turns bullets into spoken sentences", () => {
    const result = cleanupScript({
      text: "- Clean operation\n* Safe handling",
      seed: "seed"
    });
    expect(result.cleanedText).toContain("Key point:");
    expect(result.warnings).toContain("bullets_normalized");
  });

  it("is deterministic for the same seed", () => {
    const input = { text: "Important steps are common.", seed: "fixed" };
    const first = cleanupScript(input);
    const second = cleanupScript(input);
    expect(first.cleanedText).toBe(second.cleanedText);
  });
});

describe("reflowCaptionText", () => {
  it("wraps text and repairs split words", () => {
    const output = reflowCaptionText({
      text: "activat ion B ecause H olding",
      maxLineChars: 42
    });
    expect(output).toContain("activation Because Holding");
    output.split("\n").forEach((line) => {
      expect(line.length).toBeLessThanOrEqual(42);
    });
  });
});
