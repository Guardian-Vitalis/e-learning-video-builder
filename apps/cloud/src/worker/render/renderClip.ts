import type { RenderProfile, StubAvatarStyle, StubBackgroundStyle } from "@evb/shared";
import { renderStubMp4 } from "../../lib/stubVideo";
import { getLocalAvatarConfig } from "../../lib/config";
import { renderClipWithLocalMuseTalk } from "./providers/local_musetalk";

export type RenderClipInput = {
  provider: string;
  clipId: string;
  outputPathAbs: string;
  durationSec: number;
  audioPathAbs: string;
  audioDurationMs: number;
  transcript: string;
  avatarPresetId?: string;
  avatarId?: string;
  bboxShift?: number;
  preparationHint?: "auto" | "prefer_cached" | "force_prepare";
  fps?: number;
  fallbackProfile: RenderProfile;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
  jobId?: string;
  segmentImageAbs?: string;
  courseTitle?: string;
  sectionTitle?: string;
  onLocalAvatarError?: (err: Error) => void;
};

export async function renderClip(input: RenderClipInput): Promise<RenderProfile> {
  if (input.provider === "local_musetalk") {
    try {
      const config = getLocalAvatarConfig();
      await renderClipWithLocalMuseTalk(config, {
        jobId: input.jobId ?? "local-job",
        clipId: input.clipId,
        outputPathAbs: input.outputPathAbs,
        transcript: input.transcript,
        avatarPresetId: input.avatarPresetId,
        avatarId: input.avatarId,
        bboxShift: input.bboxShift,
        preparationHint: input.preparationHint,
        audioPathAbs: input.audioPathAbs,
        width: input.fallbackProfile.width,
        height: input.fallbackProfile.height,
        fps: input.fps ?? input.fallbackProfile.fps,
        timeoutMs: config.timeoutMs
      });
      return input.fallbackProfile;
    } catch (err) {
      if (input.onLocalAvatarError && err instanceof Error) {
        input.onLocalAvatarError(err);
      } else if (input.onLocalAvatarError) {
        input.onLocalAvatarError(new Error(String(err)));
      }
    }
  }

  return renderStubMp4({
    outPathAbs: input.outputPathAbs,
    durationSec: input.durationSec,
    audioPathAbs: input.audioPathAbs,
    audioDurationMs: input.audioDurationMs,
    stubAvatarStyle: input.stubAvatarStyle,
    stubBackgroundStyle: input.stubBackgroundStyle,
    jobId: input.jobId,
    segments: input.segmentImageAbs
      ? [{ durationSec: input.durationSec, imagePathAbs: input.segmentImageAbs }]
      : undefined,
    courseTitle: input.courseTitle,
    sectionTitles: input.sectionTitle ? [input.sectionTitle] : undefined
  });
}
