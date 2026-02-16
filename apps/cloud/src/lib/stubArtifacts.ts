import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
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
  countWords,
  estimateNarrationDurationMs,
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
import os from "node:os";

const ARTIFACTS_ROOT = path.resolve(process.cwd(), ".artifacts");
const CLEANUP_MODE_DEFAULT: ScriptCleanupMode = "off";
const MIN_CUE_MS = 700;
const CUE_END_BUFFER_MS = 50;
const MAX_SENTENCE_CHARS = 140;
const MAX_WORDS_PER_CUE = 12;
const MAX_CUE_CHARS = 84;
const SILENCE_SAMPLE_RATE = 48000;
const SILENCE_DURATION_MS = 1000;
const SILENT_AUDIO_TIMEOUT_MS = 12000;

function escapePowerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(command: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true }
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `powershell exited with code ${code}`));
    });
  });
}

function runFfmpeg(args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { windowsHide: true });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("ffmpeg timed out"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function resolveFfmpegPath() {
  const envPath = process.env.EVB_FFMPEG_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }
  try {
    const mod = await import("ffmpeg-static");
    const candidate = (mod as { default?: unknown } | unknown) as { default?: unknown } | unknown;
    const resolved =
      typeof candidate === "object" && candidate !== null && "default" in candidate
        ? (candidate as { default?: unknown }).default
        : candidate;
    const ffmpegPath = typeof resolved === "string" ? resolved : undefined;
    if (ffmpegPath && existsSync(ffmpegPath)) {
      return ffmpegPath;
    }
  } catch {
    // ignore
  }
  return null;
}

async function writeSilentWav(outPath: string, durationMs: number) {
  const durationSec = Math.max(1, Math.ceil(durationMs / 1000));
  const totalSamples = durationSec * SILENCE_SAMPLE_RATE;
  const data = Buffer.alloc(totalSamples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SILENCE_SAMPLE_RATE, 24);
  header.writeUInt32LE(SILENCE_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await fs.writeFile(outPath, Buffer.concat([header, data]));
}

async function writeSilentAudio(durationMs: number) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-tts-"));
  const durationSec = Math.max(1, Math.ceil(durationMs / 1000));
  const ffmpegPath = await resolveFfmpegPath();
  if (ffmpegPath) {
    const outPath = path.join(tmpDir, "silence.m4a");
    try {
      await runFfmpeg(
        [
          ffmpegPath,
          "-y",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=mono:sample_rate=48000",
          "-t",
          `${durationSec}`,
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          outPath
        ],
        SILENT_AUDIO_TIMEOUT_MS
      );
      return outPath;
    } catch {
      // fall through to wav
    }
  }

  const wavPath = path.join(tmpDir, "silence.wav");
  await writeSilentWav(wavPath, durationMs);
  return wavPath;
}

async function buildNarrationAudioForClip(input: {
  text: string;
  voice: string;
  style: string;
  wordsPerMinute: number;
  timing: { cueStartsMs: number[]; durationMs: number };
  audioProvider: ReturnType<typeof getAudioProvider>;
}) {
  const narrationText = input.text.trim();
  const estimatedDurationMs = Math.max(
    1,
    input.timing.durationMs || estimateNarrationDurationMs(input.text, input.wordsPerMinute)
  );
  if (!narrationText) {
    const silentPath = await writeSilentAudio(Math.max(estimatedDurationMs, SILENCE_DURATION_MS));
    return { path: silentPath, durationMs: estimatedDurationMs, kind: "placeholder" as const };
  }
  const providerName = (process.env.EVB_TTS_PROVIDER ?? "stub").toLowerCase();
  if (providerName !== "stub") {
    try {
      const providerAudio = await input.audioProvider.synthesize({
        text: narrationText,
        voice: input.voice,
        style: input.style,
        rate: input.wordsPerMinute,
        timing: input.timing
      });
      if (providerAudio.kind === "tts") {
        return providerAudio;
      }
    } catch {
      // fall through to local TTS/silence
    }
  }

  if (process.platform === "win32") {
    try {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-tts-"));
      const textPath = path.join(tmpDir, "clip.txt");
      const wavPath = path.join(tmpDir, "narration.wav");
      await fs.writeFile(textPath, narrationText, "utf8");
      const textArg = escapePowerShellString(textPath);
      const wavArg = escapePowerShellString(wavPath);
      const command = [
        "$ErrorActionPreference = 'Stop';",
        "Add-Type -AssemblyName System.Speech;",
        `$text = Get-Content -LiteralPath ${textArg} -Raw;`,
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
        `$synth.SetOutputToWaveFile(${wavArg});`,
        "$synth.Speak($text);",
        "$synth.Dispose();"
      ].join(" ");
      await runPowerShell(command);
      return { path: wavPath, durationMs: estimatedDurationMs, kind: "tts" as const };
    } catch {
      // fall through to silence
    }
  }

  const silentPath = await writeSilentAudio(Math.max(estimatedDurationMs, SILENCE_DURATION_MS));
  return { path: silentPath, durationMs: estimatedDurationMs, kind: "placeholder" as const };
}

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

function splitByPunctuation(text: string) {
  const parts: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      const chunk = text.slice(start, index).trim();
      if (chunk) {
        parts.push(chunk);
      }
      index += 1;
      while (index < text.length && text[index] === "\n") {
        index += 1;
      }
      start = index;
      continue;
    }
    if (".!?;:".includes(char)) {
      const next = text[index + 1];
      if (!next || next === " " || next === "\n") {
        const chunk = text.slice(start, index + 1).trim();
        if (chunk) {
          parts.push(chunk);
        }
        index += 1;
        while (index < text.length && (text[index] === " " || text[index] === "\n")) {
          index += 1;
        }
        start = index;
        continue;
      }
    }
    index += 1;
  }
  const tail = text.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

function splitBySecondary(text: string) {
  if (text.length <= MAX_SENTENCE_CHARS) {
    return [text];
  }
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "," || char === "\u2014") {
      const chunk = text.slice(start, i + 1).trim();
      if (chunk) {
        parts.push(chunk);
      }
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.length > 0 ? parts : [text];
}

function splitByWords(text: string) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  let current = "";
  let count = 0;
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && (count >= MAX_WORDS_PER_CUE || next.length > MAX_CUE_CHARS)) {
      chunks.push(current);
      current = word;
      count = 1;
      continue;
    }
    current = next;
    count += 1;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function buildReadableCues(text: string, sectionId: string) {
  const normalized = normalizeCaptionText(text).replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const cues: Array<{ startMs: number; endMs: number; text: string; sectionId: string }> = [];
  const primary = splitByPunctuation(normalized);
  primary.forEach((part) => {
    const secondary = splitBySecondary(part);
    secondary.forEach((segment) => {
      splitByWords(segment).forEach((chunk) => {
        const cleaned = normalizeCaptionText(chunk);
        if (cleaned) {
          cues.push({ startMs: 0, endMs: 0, text: cleaned, sectionId });
        }
      });
    });
  });
  return cues;
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
        const audio = await buildNarrationAudioForClip({
          text: clip.text,
          voice: settings.voicePresetId,
          style: settings.stylePresetId,
          wordsPerMinute,
          timing: {
            cueStartsMs: clipTiming.cues.map((cue) => cue.startMs),
            durationMs: clipTiming.totalDurationMs
          },
          audioProvider
        });
        let cues = buildReadableCues(clip.text, section.id);
        if (cues.length === 0) {
          cues = clipTiming.cues;
        }
        if (cues.length === 0) {
          const fallbackText = normalizeCaptionText(clip.text);
          const durationMs = estimateNarrationDurationMs(fallbackText, wordsPerMinute);
          cues = [
            {
              startMs: 0,
              endMs: Math.max(1500, durationMs),
              text: fallbackText,
              sectionId: section.id
            }
          ];
        }
        if (audio.durationMs > 0) {
          cues = scaleCuesToDuration(cues, audio.durationMs);
        }
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
        let durationMs = audio.durationMs;
        const mp4DurationMs = await getMp4DurationMs(mp4Abs);
        if (mp4DurationMs) {
          durationMs = mp4DurationMs;
        } else if (!durationMs || durationMs <= 0) {
          durationMs = estimateNarrationDurationMs(clip.text, wordsPerMinute);
        }
        if (durationMs > 0) {
          cues = fitCuesToDuration(cues, durationMs);
        }
        const vtt = toVtt(cues);
        const srt = toSrt(cues);
        await Promise.all([
          fs.writeFile(vttAbs, vtt, "utf8"),
          fs.writeFile(srtAbs, srt, "utf8")
        ]);
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
          durationMs,
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

async function getMp4DurationMs(mp4PathAbs: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", mp4PathAbs],
      { windowsHide: true },
      (err, stdout) => {
        if (err) {
          console.warn(
            `[EVB] ffprobe failed for ${mp4PathAbs}: ${err.message || "unknown error"}`
          );
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.toString()) as {
            format?: { duration?: string | number };
          };
          const durationSec = Number(parsed?.format?.duration);
          if (!Number.isFinite(durationSec) || durationSec <= 0) {
            console.warn(`[EVB] ffprobe returned invalid duration for ${mp4PathAbs}`);
            resolve(null);
            return;
          }
          resolve(Math.round(durationSec * 1000));
        } catch {
          console.warn(`[EVB] ffprobe output parse failed for ${mp4PathAbs}`);
          resolve(null);
        }
      }
    );
  });
}

function fitCuesToDuration(
  cues: Array<{ startMs: number; endMs: number; text: string; sectionId: string }>,
  durationMs: number
) {
  if (cues.length === 0 || durationMs <= 0) {
    return cues;
  }
  const maxEndMs = Math.max(0, durationMs - CUE_END_BUFFER_MS);
  const weights = cues.map((cue) => Math.max(1, countWords(cue.text)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let durations = weights.map((value) =>
    Math.max(MIN_CUE_MS, Math.round((value / totalWeight) * durationMs))
  );
  let total = durations.reduce((sum, value) => sum + value, 0);
  const targetTotal = maxEndMs || durationMs;
  if (total > targetTotal) {
    let excess = total - targetTotal;
    let changed = true;
    while (excess > 0 && changed) {
      changed = false;
      for (let i = 0; i < durations.length && excess > 0; i += 1) {
        if (durations[i] > MIN_CUE_MS) {
          durations[i] -= 1;
          excess -= 1;
          changed = true;
        }
      }
    }
    total = durations.reduce((sum, value) => sum + value, 0);
  } else if (total < targetTotal) {
    durations[durations.length - 1] += targetTotal - total;
  }

  let cursor = 0;
  return cues.map((cue, index) => {
    const startMs = cursor;
    const endMs = Math.min(targetTotal, cursor + durations[index]);
    cursor = endMs;
    return { ...cue, startMs, endMs };
  });
}
