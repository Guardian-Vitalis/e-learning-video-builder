import path from "node:path";
import { promises as fs } from "node:fs";
import {
  ApprovedManifest,
  ArtifactClip,
  ArtifactSectionManifest,
  ArtifactSectionVariation,
  GenerationSettings,
  JobArtifacts,
  JobArtifactsManifest,
  ScriptCleanupMode,
  CleanupConfig,
  cleanupScript,
  RenderProfile,
  StubAvatarStyle,
  StubBackgroundStyle,
  LocalAvatarAdvancedSettings
} from "@evb/shared";
import {
  buildCuePlan,
  buildCuePlanByWords,
  normalizeCaptionText,
  splitIntoSentences,
  scaleCuesToDuration,
  toSrt,
  toVtt
} from "./captions";
import { getAudioProvider } from "./audio/audioProvider";
import { planSectionClips } from "./planner/clipPlanner";
import { getRunMode } from "./config";
import { maybeLlmCleanup } from "./scriptCleanup/llmCleanup";
import { renderClip } from "../worker/render/renderClip";
import { filterSectionsByTargetIds } from "./targetSections";

const ARTIFACTS_ROOT = path.resolve(process.cwd(), ".artifacts");
const CLEANUP_MODE_DEFAULT: ScriptCleanupMode = "off";

function resolveCleanupMode(
  requested: ScriptCleanupMode | undefined
): { mode: ScriptCleanupMode; warnings: string[] } {
  const warnings: string[] = [];
  if (!requested || requested === "off") {
    return { mode: "off", warnings };
  }
  if (requested === "llm") {
    return { mode: "llm", warnings };
  }
  return { mode: "deterministic", warnings };
}

export function getArtifactFilePaths(jobId: string) {
  const dir = path.join(ARTIFACTS_ROOT, jobId);
  return {
    dir,
    mp4Abs: path.join(dir, "video.mp4"),
    vttAbs: path.join(dir, "captions.vtt"),
    srtAbs: path.join(dir, "captions.srt"),
    primaryMp4Abs: path.join(dir, "primary.mp4"),
    primaryVttAbs: path.join(dir, "primary.vtt"),
    primarySrtAbs: path.join(dir, "primary.srt"),
    manifestAbs: path.join(dir, "manifest.json")
  };
}

export function buildCaptionsForManifest(
  manifest: ApprovedManifest,
  settings: GenerationSettings,
  options?: {
    timing?: "fixed" | "word";
    wordsPerMinute?: number;
    targetDurationMs?: number;
  }
) {
  let cues =
    options?.timing === "word"
      ? buildCuePlanByWords({
          manifest,
          settings,
          wordsPerMinute: options?.wordsPerMinute
        }).cues
      : buildCuePlan({ manifest, settings });
  let usedFallback = false;
  if (cues.length === 0 && manifest.sections.length > 0) {
    usedFallback = true;
    cues = manifest.sections.map((section, index) => ({
      startMs: index * 1000,
      endMs: index * 1000 + 900,
      text: normalizeCaptionText(section.title?.trim() || `Section ${index + 1}`),
      sectionId: section.id
    }));
  }
  if (options?.targetDurationMs && cues.length > 0) {
    cues = scaleCuesToDuration(cues, options.targetDurationMs);
  }
  return {
    cues,
    vtt: toVtt(cues),
    srt: toSrt(cues),
    usedFallback
  };
}

export async function generateStubArtifacts(input: {
  jobId: string;
  manifest: ApprovedManifest;
  settings: GenerationSettings;
  sectionImages?: Record<string, string>;
  scriptCleanupMode?: ScriptCleanupMode;
  cleanupConfigOverrides?: Partial<CleanupConfig>;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
  avatarProvider?: string;
  targetSectionIds?: string[];
  localAvatarAdvanced?: LocalAvatarAdvancedSettings;
}): Promise<JobArtifacts> {
  const { jobId, manifest, settings, sectionImages } = input;
  const wordsPerMinute = Number(process.env.EVB_STUB_WPM || 170);
  const audioProvider = getAudioProvider();
  const avatarProvider = input.avatarProvider ?? "stub";
  let loggedLocalFallback = false;
  const paths = getArtifactFilePaths(jobId);
  await fs.mkdir(paths.dir, { recursive: true });

  const hasTargets = Boolean(input.targetSectionIds && input.targetSectionIds.length > 0);
  const existingManifest = hasTargets
    ? await (async () => {
        try {
          const raw = await fs.readFile(paths.manifestAbs, "utf8");
          return JSON.parse(raw) as JobArtifactsManifest;
        } catch {
          return null;
        }
      })()
    : null;
  const targetSet =
    hasTargets && existingManifest
      ? new Set(input.targetSectionIds)
      : null;
  const existingSectionsById = existingManifest
    ? new Map(existingManifest.sections.map((section) => [section.sectionId, section]))
    : new Map<string, ArtifactSectionManifest>();

  const manifestSections: ArtifactSectionManifest[] = [];
  let primaryClip: ArtifactClip | null = null;
  let primaryVtt = "";
  let primarySrt = "";
  let renderProfile: RenderProfile | undefined = existingManifest?.renderProfile ?? undefined;
  const cleanupChoice = resolveCleanupMode(
    input.scriptCleanupMode ?? manifest.cleanupMode ?? CLEANUP_MODE_DEFAULT
  );
  const cleanupMode = cleanupChoice.mode;
  const stubAvatarStyle = input.stubAvatarStyle ?? "silhouette";
  const stubBackgroundStyle = input.stubBackgroundStyle ?? "neutral";
  const localAvatarAdvanced =
    avatarProvider === "local_musetalk" ? input.localAvatarAdvanced : undefined;
  const fallbackProfile: RenderProfile = {
    width: 1280,
    height: 720,
    fps: 30,
    codec: "mpeg4",
    pixelFormat: "yuv420p"
  };

  const shouldUpdatePrimary =
    !targetSet || targetSet.has(manifest.sections[0]?.id ?? "");
  const renderSections = targetSet
    ? filterSectionsByTargetIds(manifest.sections, input.targetSectionIds)
    : manifest.sections;
  const renderSectionIds = new Set(renderSections.map((section) => section.id));

  for (const [sectionIndex, section] of manifest.sections.entries()) {
    if (targetSet && !renderSectionIds.has(section.id)) {
      const existing = existingSectionsById.get(section.id);
      if (existing) {
        manifestSections.push(existing);
        continue;
      }
    }
    const cleanupSeed = `${manifest.draftSignature}:${section.id}`;
    const sectionCleanup =
      cleanupMode === "off"
        ? {
            cleanedText: section.script,
            warnings: [],
            stats: {
              originalChars: section.script.length,
              cleanedChars: section.script.length,
              sentenceCount: 0
            }
          }
        : cleanupScript({
            text: section.script,
            seed: cleanupSeed,
            config: input.cleanupConfigOverrides
          });
    const plan = planSectionClips({
      sectionId: section.id,
      sourceText: section.script,
      sentencesPerClip: settings.sentencesPerClip,
      variationsPerSection: settings.variationsPerSection,
      seedKey: `${manifest.draftSignature}:${section.id}`
    });

    const variations: ArtifactSectionVariation[] = [];
    for (const variation of plan.variations) {
      const variationSeed = `${cleanupSeed}:v${variation.variationIndex}`;
      let variationCleanup =
        cleanupMode === "off"
          ? {
              cleanedText: variation.text,
              warnings: [],
              stats: {
                originalChars: variation.text.length,
                cleanedChars: variation.text.length,
                sentenceCount: 0
              }
            }
          : cleanupScript({
              text: variation.text,
              seed: variationSeed,
              config: input.cleanupConfigOverrides
            });
      if (cleanupMode === "llm") {
        const llmResult = await maybeLlmCleanup({
          text: variation.text,
          sectionId: section.id,
          variationIndex: variation.variationIndex
        });
        if (llmResult.used) {
          variationCleanup = {
            cleanedText: llmResult.cleanedText,
            warnings: llmResult.warnings,
            stats: {
              originalChars: variation.text.length,
              cleanedChars: llmResult.cleanedText.length,
              sentenceCount: splitIntoSentences(llmResult.cleanedText).length
            }
          };
        } else {
          variationCleanup = {
            ...variationCleanup,
            warnings: variationCleanup.warnings.concat(llmResult.warnings)
          };
        }
      }
      const cleanedVariationText = variationCleanup.cleanedText || variation.text;
      const clips: ArtifactClip[] = [];
      const variationDirRel = path.posix.join(
        jobId,
        "sections",
        section.id,
        `v${variation.variationIndex}`
      );
      const variationDirAbs = path.join(
        paths.dir,
        "sections",
        section.id,
        `v${variation.variationIndex}`
      );
      await fs.mkdir(variationDirAbs, { recursive: true });

      const sentences = splitIntoSentences(cleanedVariationText);
      const plannedClips =
        sentences.length > 0
          ? sentences.reduce<Array<{ clipIndex: number; text: string }>>((acc, sentence, index) => {
              const clipIndex = Math.floor(index / settings.sentencesPerClip);
              const existing = acc[clipIndex];
              if (existing) {
                existing.text = `${existing.text} ${sentence}`.trim();
              } else {
                acc.push({ clipIndex, text: sentence });
              }
              return acc;
            }, [])
          : [{ clipIndex: 0, text: section.title ?? `Section ${sectionIndex + 1}` }];
      for (const clip of plannedClips) {
        const clipBase = `clip-${clip.clipIndex}`;
        const mp4Rel = path.posix.join(variationDirRel, `${clipBase}.mp4`);
        const vttRel = path.posix.join(variationDirRel, `${clipBase}.vtt`);
        const srtRel = path.posix.join(variationDirRel, `${clipBase}.srt`);
        const mp4Abs = path.join(variationDirAbs, `${clipBase}.mp4`);
        const vttAbs = path.join(variationDirAbs, `${clipBase}.vtt`);
        const srtAbs = path.join(variationDirAbs, `${clipBase}.srt`);

        const clipManifest: ApprovedManifest = {
          manifestVersion: "0.1",
          courseTitle: manifest.courseTitle,
          approvedAt: manifest.approvedAt,
          draftSignature: manifest.draftSignature,
          cleanupMode,
          sections: [{ id: section.id, title: section.title, script: clip.text }]
        };
        const clipTiming = buildCuePlanByWords({
          manifest: clipManifest,
          settings,
          wordsPerMinute
        });
        const audio = await audioProvider.synthesize({
          text: clip.text,
          voice: settings.voicePresetId,
          style: settings.stylePresetId,
          rate: wordsPerMinute,
          timing: {
            cueStartsMs: clipTiming.cues.map((cue) => cue.startMs),
            durationMs: clipTiming.totalDurationMs
          }
        });
        let cues = clipTiming.cues;
        if (audio.durationMs > 0) {
          cues = scaleCuesToDuration(cues, audio.durationMs);
        }
        const vtt = toVtt(cues);
        const srt = toSrt(cues);
        await Promise.all([
          fs.writeFile(vttAbs, vtt, "utf8"),
          fs.writeFile(srtAbs, srt, "utf8")
        ]);

        let segmentImage: string | undefined;
        if (sectionImages?.[section.id]) {
          const relPath = sectionImages[section.id];
          const imagePathAbs = path.resolve(process.cwd(), relPath);
          try {
            await fs.access(imagePathAbs);
            segmentImage = imagePathAbs;
          } catch {
            segmentImage = undefined;
          }
        }
        const durationSec = Math.max(1, Math.ceil(audio.durationMs / 1000));
        const profile = await renderClip({
          provider: avatarProvider,
          clipId: `${jobId}:${section.id}:v${variation.variationIndex}:${clip.clipIndex}`,
          outputPathAbs: mp4Abs,
          durationSec,
          audioPathAbs: audio.path,
          audioDurationMs: audio.durationMs,
          transcript: clip.text,
          avatarPresetId: settings.avatarPresetId,
          avatarId: localAvatarAdvanced?.avatarId,
          bboxShift: localAvatarAdvanced?.bboxShift,
          fps: localAvatarAdvanced?.fps,
          fallbackProfile,
          stubAvatarStyle,
          stubBackgroundStyle,
          jobId,
          segmentImageAbs: segmentImage,
          courseTitle: manifest.courseTitle,
          sectionTitle: section.title,
          onLocalAvatarError: (err) => {
            if (loggedLocalFallback) {
              return;
            }
            console.warn(
              `[EVB] local avatar render failed, falling back to stub: ${err.message}`
            );
            loggedLocalFallback = true;
          }
        });
        if (!renderProfile) {
          renderProfile = profile;
        }

        const clipId = `${section.id}-v${variation.variationIndex}-c${clip.clipIndex}`;
        const artifactClip: ArtifactClip = {
          id: clipId,
          text: normalizeCaptionText(clip.text),
          mp4Path: mp4Rel,
          vttPath: vttRel,
          srtPath: srtRel,
          durationMs: audio.durationMs,
          sectionId: section.id,
          variationIndex: variation.variationIndex,
          clipIndex: clip.clipIndex,
          render: {
            avatarStyle: stubAvatarStyle,
            backgroundStyle: stubBackgroundStyle,
            profile: profile ?? fallbackProfile
          }
        };
        clips.push(artifactClip);

        if (!primaryClip && shouldUpdatePrimary) {
          primaryClip = artifactClip;
          primaryVtt = vtt;
          primarySrt = srt;
          await Promise.all([
            fs.copyFile(mp4Abs, paths.primaryMp4Abs),
            fs.writeFile(paths.primaryVttAbs, vtt, "utf8"),
            fs.writeFile(paths.primarySrtAbs, srt, "utf8")
          ]);
        }
      }
      variations.push({
        variationIndex: variation.variationIndex,
        text: normalizeCaptionText(variation.text),
        sourceText: normalizeCaptionText(variation.text),
        cleanedNarrationText: normalizeCaptionText(cleanedVariationText),
        cleanupMode,
        cleanupWarnings: cleanupChoice.warnings.concat(variationCleanup.warnings),
        clips
      });
    }

    manifestSections.push({
      sectionId: section.id,
      title: section.title,
      sourceText: normalizeCaptionText(section.script),
      cleanedNarrationText: normalizeCaptionText(sectionCleanup.cleanedText),
      cleanupMode,
      cleanupWarnings: cleanupChoice.warnings.concat(sectionCleanup.warnings),
      variations
    });
  }

  const fallbackPrimary: ArtifactClip = primaryClip ?? {
    id: "primary",
    text: manifest.sections[0]?.title ?? "Primary",
    mp4Path: existingManifest?.primary?.mp4Path ?? path.posix.join(jobId, "primary.mp4"),
    vttPath: existingManifest?.primary?.vttPath ?? path.posix.join(jobId, "primary.vtt"),
    srtPath: existingManifest?.primary?.srtPath ?? path.posix.join(jobId, "primary.srt"),
    durationMs: existingManifest?.primary?.durationMs ?? 3000,
    sectionId: manifest.sections[0]?.id ?? "section-1",
    variationIndex: 0,
    clipIndex: 0
  };

  const manifestPayload: JobArtifactsManifest = {
    version: 1,
    jobId,
    mode: getRunMode(),
    provider: avatarProvider,
    cleanupMode,
    stubAvatarStyle,
    stubBackgroundStyle,
    renderProfile: renderProfile ?? fallbackProfile,
    settings: {
      sentencesPerClip: settings.sentencesPerClip,
      variationsPerSection: settings.variationsPerSection
    },
    sections: manifestSections,
    primary: {
      mp4Path: fallbackPrimary.mp4Path,
      vttPath: fallbackPrimary.vttPath,
      srtPath: fallbackPrimary.srtPath,
      durationMs: fallbackPrimary.durationMs
    }
  };

  await fs.writeFile(paths.manifestAbs, JSON.stringify(manifestPayload, null, 2), "utf8");

  if (primaryClip) {
    if (shouldUpdatePrimary) {
      await Promise.all([
        fs.copyFile(paths.primaryMp4Abs, paths.mp4Abs),
        fs.copyFile(paths.primaryVttAbs, paths.vttAbs),
        fs.copyFile(paths.primarySrtAbs, paths.srtAbs)
      ]);
    }
  }

  return {
    mp4Path: `/v1/jobs/${jobId}/artifacts/video.mp4`,
    vttPath: `/v1/jobs/${jobId}/artifacts/captions.vtt`,
    srtPath: `/v1/jobs/${jobId}/artifacts/captions.srt`,
    manifestPath: `/v1/jobs/${jobId}/artifacts/manifest.json`,
    expiresAt: new Date().toISOString()
  };
}
