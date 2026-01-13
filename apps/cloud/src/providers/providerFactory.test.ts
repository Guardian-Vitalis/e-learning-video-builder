import { describe, expect, it } from "vitest";
import { getAvatarProviderFromEnv } from "./providerFactory";
import { createStubProvider } from "./stubProvider";

describe("getAvatarProviderFromEnv", () => {
  it("defaults to stub when AVATAR_PROVIDER is not set", () => {
    const provider = getAvatarProviderFromEnv({}, "split");
    expect(provider.name).toBe("stub");
  });

  it("returns stub when AVATAR_PROVIDER=stub", () => {
    const provider = getAvatarProviderFromEnv({ AVATAR_PROVIDER: "stub" }, "split");
    expect(provider.name).toBe("stub");
  });

  it("throws for unknown providers in split mode", () => {
    expect(() => getAvatarProviderFromEnv({ AVATAR_PROVIDER: "bad" }, "split")).toThrow(
      "Unknown AVATAR_PROVIDER=bad. Supported: stub, local_musetalk"
    );
  });

  it("falls back to stub provider in solo mode", () => {
    const provider = getAvatarProviderFromEnv({ AVATAR_PROVIDER: "bad" }, "solo");
    expect(provider.name).toBe("stub");
  });

  it("stub provider generates variations per section", async () => {
    const provider = createStubProvider();
    const result = await provider.generateClips({
      jobId: "job-1",
      approvedManifest: {
        manifestVersion: "0.1",
        courseTitle: "Course",
        approvedAt: new Date().toISOString(),
        draftSignature: "sig",
        sections: [
          { id: "s1", title: "Intro", script: "Hello" },
          { id: "s2", title: "Next", script: "World" }
        ]
      },
      settings: {
        outputMode: "avatar_only",
        avatarPresetId: "avatar_a",
        voicePresetId: "voice_1",
        stylePresetId: "style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 3,
        updatedAt: new Date().toISOString()
      }
    });

    expect(result.clips.length).toBe(6);
    const variationIndexes = result.clips
      .filter((clip) => clip.sectionId === "s1")
      .map((clip) => clip.variationIndex)
      .sort();
    expect(variationIndexes).toEqual([0, 1, 2]);
  });

  it("returns local_musetalk when configured", () => {
    const provider = getAvatarProviderFromEnv({ AVATAR_PROVIDER: "local_musetalk" }, "split");
    expect(provider.name).toBe("local_musetalk");
  });
});
