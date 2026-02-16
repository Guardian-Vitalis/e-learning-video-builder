import { describe, expect, it } from "vitest";
import {
  buildCuePlan,
  normalizeCaptionText,
  splitIntoSentences,
  toSrt,
  toVtt
} from "./captions";
import type { ApprovedManifest, GenerationSettings } from "@evb/shared";

describe("captions", () => {
  const manifest: ApprovedManifest = {
    manifestVersion: "0.1",
    courseTitle: "Course",
    approvedAt: "2024-01-01T00:00:00.000Z",
    draftSignature: "sig",
    sections: [
      { id: "s1", title: "Intro", script: "One. Two? Three!" },
      { id: "s2", title: "Next", script: "Four. Five." }
    ]
  };

  const settings: GenerationSettings = {
    outputMode: "avatar_only",
    avatarPresetId: "avatar_a",
    voicePresetId: "voice_1",
    stylePresetId: "style_clean",
    sentencesPerClip: 2,
    variationsPerSection: 1,
    updatedAt: "2024-01-01T00:00:00.000Z"
  };

  it("splits scripts into sentences", () => {
    expect(splitIntoSentences("Hello world. Next!")).toEqual([
      "Hello world.",
      "Next!"
    ]);
  });

  it("builds a monotonic cue plan with lead-ins and clip gaps", () => {
    const cues = buildCuePlan({ manifest, settings });
    expect(cues.length).toBe(5);
    expect(cues[0].startMs).toBe(1000);
    expect(cues[1].startMs).toBe(3800);
    expect(cues[2].startMs).toBe(7000);
    expect(cues[3].startMs).toBe(10800);
    expect(cues[4].startMs).toBe(13600);
    expect(cues[2].startMs - cues[1].endMs).toBe(400);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i].startMs).toBeGreaterThan(cues[i - 1].startMs);
    }
  });

  it("formats VTT and SRT output", () => {
    const cues = buildCuePlan({ manifest, settings });
    const vtt = toVtt(cues);
    const srt = toSrt(cues);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);
    expect(srt.startsWith("1")).toBe(true);
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
  });

  it("normalizes caption text artifacts", () => {
    expect(normalizeCaptionText("activat ion")).toBe("activation");
    expect(normalizeCaptionText("B ecause it matters")).toBe("Because it matters");
    expect(normalizeCaptionText("H olding ( focus )")).toBe("Holding (focus)");
    expect(normalizeCaptionText("Wait , what ?")).toBe("Wait, what?");
  });

  it("reflows and repairs caption output", () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: "activat ion B ecause H olding", sectionId: "s1" }
    ];
    const vtt = toVtt(cues);
    expect(vtt).toContain("activation Because Holding");
    const lines = vtt.split("\n").filter((line) => line && !line.startsWith("WEBVTT") && !line.includes("-->"));
    expect(lines.every((line) => line.length <= 42)).toBe(true);
  });
});
