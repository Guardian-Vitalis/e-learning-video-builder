import type { AvatarProvider, GenerateClipsInput, ProviderClip } from "./types";

function buildClips(input: GenerateClipsInput): ProviderClip[] {
  const sections = input.approvedManifest.sections;
  const variations = Math.max(1, input.settings.variationsPerSection);
  const clips: ProviderClip[] = [];
  sections.forEach((section, sectionIndex) => {
    for (let variationIndex = 0; variationIndex < variations; variationIndex += 1) {
      clips.push({
        id: `${input.jobId}_clip_${sectionIndex + 1}_${variationIndex + 1}`,
        sectionId: section.id,
        index: sectionIndex,
        variationIndex,
        durationSec: Math.max(4, input.settings.sentencesPerClip * 2)
      });
    }
  });
  return clips;
}

export function createLocalMusetalkProvider(): AvatarProvider {
  return {
    name: "local_musetalk",
    async generateClips(input: GenerateClipsInput) {
      return { clips: buildClips(input) };
    }
  };
}
