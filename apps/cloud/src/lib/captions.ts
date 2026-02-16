import { ApprovedManifest, GenerationSettings, reflowCaptionText } from "@evb/shared";

const SENTENCE_DURATION_MS = 2800;
const CLIP_GAP_MS = 400;
const SECTION_LEAD_IN_MS = 1000;
const MIN_SENTENCE_MS = 1200;
const MAX_SENTENCE_MS = 9000;

export type CaptionCue = {
  startMs: number;
  endMs: number;
  text: string;
  sectionId: string;
};

export function splitIntoSentences(script: string): string[] {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function normalizeCaptionText(text: string): string {
  let normalized = text.replace(/\s+/g, " ").trim();
  normalized = normalized.replace(/\b([B-HJ-Z])\s+([a-z]{3,})\b/g, "$1$2");
  normalized = normalized.replace(
    /\b([a-z]{3,})\s+(ion|ing|ed|ly|ment|tion|sion|ers|er|al|ive|able|ous|ance|ence|ity)\b/g,
    "$1$2"
  );
  normalized = normalized.replace(/\s+([,.;:!?])/g, "$1");
  normalized = normalized.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  normalized = normalized.replace(/\s+([)\]}])/g, "$1");
  normalized = normalized.replace(/([([{])\s+/g, "$1");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

export function countWords(text: string): number {
  const normalized = text.replace(/[^\p{L}\p{N}'-]+/gu, " ").trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).filter(Boolean).length;
}

export function estimateSentenceDurationMs(
  sentence: string,
  wordsPerMinute = 170
): number {
  const words = countWords(sentence);
  if (words === 0) {
    return MIN_SENTENCE_MS;
  }
  const durationMs = Math.ceil((words / wordsPerMinute) * 60000);
  return Math.min(MAX_SENTENCE_MS, Math.max(MIN_SENTENCE_MS, durationMs));
}

export function estimateNarrationDurationMs(text: string, wordsPerMinute = 170): number {
  const words = countWords(text);
  if (words === 0) {
    return 2000;
  }
  const durationMs = Math.ceil((words / wordsPerMinute) * 60000);
  return Math.max(2000, durationMs);
}

export function buildCuePlan(args: {
  manifest: ApprovedManifest;
  settings: GenerationSettings;
}): CaptionCue[] {
  const { manifest, settings } = args;
  const cues: CaptionCue[] = [];
  let cursorMs = 0;
  const sentencesPerClip = Math.max(1, settings.sentencesPerClip);

  for (const section of manifest.sections) {
    cursorMs += SECTION_LEAD_IN_MS;
    const sentences = splitIntoSentences(section.script);

    sentences.forEach((sentence, index) => {
      const normalizedText = normalizeCaptionText(sentence);
      const startMs = cursorMs;
      const endMs = startMs + SENTENCE_DURATION_MS;
      cues.push({
        startMs,
        endMs,
        text: normalizedText,
        sectionId: section.id
      });
      cursorMs = endMs;
      const isClipBoundary = (index + 1) % sentencesPerClip === 0;
      if (isClipBoundary && index + 1 < sentences.length) {
        cursorMs += CLIP_GAP_MS;
      }
    });
  }

  return cues;
}

export function buildCuePlanByWords(args: {
  manifest: ApprovedManifest;
  settings: GenerationSettings;
  wordsPerMinute?: number;
}) {
  const { manifest, settings } = args;
  const cues: CaptionCue[] = [];
  let cursorMs = 0;
  const sentencesPerClip = Math.max(1, settings.sentencesPerClip);
  const wpm = args.wordsPerMinute ?? 170;

  for (const section of manifest.sections) {
    cursorMs += SECTION_LEAD_IN_MS;
    const sentences = splitIntoSentences(section.script);

    sentences.forEach((sentence, index) => {
      const normalizedText = normalizeCaptionText(sentence);
      const startMs = cursorMs;
      const durationMs = estimateSentenceDurationMs(normalizedText, wpm);
      const endMs = startMs + durationMs;
      cues.push({
        startMs,
        endMs,
        text: normalizedText,
        sectionId: section.id
      });
      cursorMs = endMs;
      const isClipBoundary = (index + 1) % sentencesPerClip === 0;
      if (isClipBoundary && index + 1 < sentences.length) {
        cursorMs += CLIP_GAP_MS;
      }
    });
  }

  return {
    cues,
    totalDurationMs: cursorMs
  };
}

export function scaleCuesToDuration(cues: CaptionCue[], targetDurationMs: number): CaptionCue[] {
  if (cues.length === 0) {
    return cues;
  }
  const lastEnd = cues[cues.length - 1].endMs;
  if (lastEnd <= 0 || targetDurationMs <= 0) {
    return cues;
  }
  const ratio = targetDurationMs / lastEnd;
  return cues.map((cue) => ({
    ...cue,
    startMs: Math.round(cue.startMs * ratio),
    endMs: Math.round(cue.endMs * ratio)
  }));
}

export function buildSectionDurations(args: {
  manifest: ApprovedManifest;
  settings: GenerationSettings;
}) {
  const { manifest, settings } = args;
  const durations: Record<string, number> = {};
  const sentencesPerClip = Math.max(1, settings.sentencesPerClip);

  for (const section of manifest.sections) {
    let sectionMs = SECTION_LEAD_IN_MS;
    const sentences = splitIntoSentences(section.script);
    sentences.forEach((_sentence, index) => {
      sectionMs += SENTENCE_DURATION_MS;
      const isClipBoundary = (index + 1) % sentencesPerClip === 0;
      if (isClipBoundary && index + 1 < sentences.length) {
        sectionMs += CLIP_GAP_MS;
      }
    });
    durations[section.id] = sectionMs;
  }

  return durations;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function pad3(value: number) {
  return value.toString().padStart(3, "0");
}

function formatTimeVtt(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

function formatTimeSrt(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

export function toVtt(cues: CaptionCue[]): string {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue) => {
    lines.push(`${formatTimeVtt(cue.startMs)} --> ${formatTimeVtt(cue.endMs)}`);
    lines.push(reflowCaptionText({ text: cue.text, maxLineChars: 42 }));
    lines.push("");
  });
  return lines.join("\n");
}

export function toSrt(cues: CaptionCue[]): string {
  const lines: string[] = [];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatTimeSrt(cue.startMs)} --> ${formatTimeSrt(cue.endMs)}`);
    lines.push(reflowCaptionText({ text: cue.text, maxLineChars: 42 }));
    lines.push("");
  });
  return lines.join("\n");
}
