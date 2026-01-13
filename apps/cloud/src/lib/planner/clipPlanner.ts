type ClipPlan = {
  sectionId: string;
  sourceText: string;
  variations: Array<{
    variationIndex: number;
    text: string;
    clips: Array<{ clipIndex: number; text: string }>;
  }>;
};

const SYNONYMS: Record<string, string[]> = {
  learn: ["understand", "explore"],
  create: ["build", "make"],
  use: ["apply", "utilize"],
  important: ["key", "essential"],
  easy: ["simple", "straightforward"],
  explain: ["describe", "outline"],
  guide: ["walk through", "show"],
  example: ["sample", "illustration"],
  focus: ["concentrate", "emphasize"],
  overview: ["summary", "high-level view"]
};

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return function rand() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tokenizeWords(text: string) {
  return text.split(/(\b)/);
}

function replaceWithSynonyms(sentence: string, rand: () => number) {
  const parts = tokenizeWords(sentence);
  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      const options = SYNONYMS[lower];
      if (!options) {
        return part;
      }
      if (rand() < 0.25) {
        const choice = options[Math.floor(rand() * options.length)];
        if (part[0] === part[0]?.toUpperCase()) {
          return choice[0].toUpperCase() + choice.slice(1);
        }
        return choice;
      }
      return part;
    })
    .join("");
}

export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function groupSentences(sentences: string[], sentencesPerClip: number): string[] {
  const groups: string[] = [];
  const size = Math.max(1, sentencesPerClip);
  for (let i = 0; i < sentences.length; i += size) {
    groups.push(sentences.slice(i, i + size).join(" "));
  }
  return groups;
}

export function generateVariations(sectionText: string, count: number, seedKey: string) {
  const variations: string[] = [];
  const baseSentences = splitIntoSentences(sectionText);

  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      variations.push(sectionText);
      continue;
    }
    const seed = hashString(`${seedKey}:${index}`);
    const rand = mulberry32(seed);
    let sentences = baseSentences.map((sentence) => replaceWithSynonyms(sentence, rand));

    if (sentences.length > 2 && rand() < 0.35) {
      const mid = sentences.slice(1);
      for (let i = mid.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        const temp = mid[i];
        mid[i] = mid[j];
        mid[j] = temp;
      }
      sentences = [sentences[0], ...mid];
    }

    variations.push(sentences.join(" "));
  }

  return variations;
}

export function planSectionClips(args: {
  sectionId: string;
  sourceText: string;
  sentencesPerClip: number;
  variationsPerSection: number;
  seedKey: string;
}): ClipPlan {
  const variations = generateVariations(
    args.sourceText,
    Math.max(1, args.variationsPerSection),
    args.seedKey
  );

  return {
    sectionId: args.sectionId,
    sourceText: args.sourceText,
    variations: variations.map((text, variationIndex) => {
      const sentences = splitIntoSentences(text);
      const clipTexts =
        sentences.length === 0
          ? [text.trim()].filter(Boolean)
          : groupSentences(sentences, args.sentencesPerClip);
      return {
        variationIndex,
        text,
        clips: clipTexts.map((clipText, clipIndex) => ({
          clipIndex,
          text: clipText.trim()
        }))
      };
    })
  };
}
