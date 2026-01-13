import { ApprovedManifest, GenerationSettings } from "@evb/shared";

export type ProviderClip = {
  id: string;
  sectionId: string;
  index: number;
  variationIndex: number;
  durationSec: number;
};

export type GenerateClipsInput = {
  jobId: string;
  approvedManifest: ApprovedManifest;
  settings: GenerationSettings;
};

export interface AvatarProvider {
  name: string;
  generateClips(input: GenerateClipsInput): Promise<{ clips: ProviderClip[] }>;
}
