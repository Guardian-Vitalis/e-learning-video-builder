import type { CleanupConfig, CleanupResult } from "../types";

const DEFAULT_ABBREVIATIONS: Record<string, string> = {
  "e.g.": "for example",
  "i.e.": "that is",
  "vs.": "versus",
  "approx.": "approximately",
  "w/": "with",
  "w/o": "without"
};

const DEFAULT_CONFIG: Required<CleanupConfig> = {
  expandAbbreviations: true,
  abbreviations: DEFAULT_ABBREVIATIONS,
  maxWordsPerSentence: 22,
  maxLineChars: 42,
  addPauses: true,
  synonymSubstitutions: true,
  substitutionRate: 0.08
};

function normalizeSpacing(input: string) {
  let text = input.replace(/\s+/g, " ").trim();
  text = text.replace(/\s+([,.;:!?])/g, "$1");
  text = text.replace(/:([^\s])/g, ": $1");
  text = text.replace(/\s+\)/g, ")");
  text = text.replace(/\(\s+/g, "(");
  return text.replace(/\s+/g, " ").trim();
}

function repairSplitWords(input: string) {
  let text = input;
  text = text.replace(/\b([B-HJ-Z])\s+([a-z]{3,})\b/g, "$1$2");
  text = text.replace(
    /\b([a-z]{3,})\s+(ion|ing|ed|ly|ment|tion|sion|ers|er|al|ive|able|ous|ance|ence|ity)\b/gi,
    "$1$2"
  );
  return text;
}

function detectWarnings(input: string): string[] {
  const warnings: string[] = [];
  const tableLike = (input.match(/\|/g)?.length ?? 0) >= 3 || /\t{2,}/.test(input) || / {3,}/.test(input);
  if (tableLike) {
    warnings.push("tables_detected_left_as_is");
  }
  if (/https?:\/\/\S+|www\.\S+/i.test(input)) {
    warnings.push("urls_present");
  }
  const acronyms = input.match(/\b[A-Z]{2,}\b/g);
  if (acronyms && acronyms.length >= 3) {
    warnings.push("acronyms_present_not_expanded");
  }
  return warnings;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCase(original: string, replacement: string) {
  if (original.toUpperCase() === original) {
    return replacement.toUpperCase();
  }
  if (original[0]?.toUpperCase() === original[0]) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function expandAbbreviations(text: string, abbreviations: Record<string, string>) {
  let expanded = text;
  for (const [key, replacement] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${escapeRegex(key)}\\b`, "gi");
    expanded = expanded.replace(regex, (match) => applyCase(match, replacement));
  }
  return expanded;
}

function detectBullet(line: string) {
  return /^\s*(?:[-*•]|[0-9]+[.)]|[a-zA-Z][.)]|\([0-9]+\)|\([a-zA-Z]\))\s+/.test(
    line
  );
}

function stripBullet(line: string) {
  return line.replace(
    /^\s*(?:[-*•]|[0-9]+[.)]|[a-zA-Z][.)]|\([0-9]+\)|\([a-zA-Z]\))\s+/,
    ""
  );
}

function hasVerb(line: string) {
  return /\b(is|are|was|were|be|has|have|do|does|can|will|should|must|need|use)\b/i.test(
    line
  );
}

function splitIntoSentences(text: string) {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function splitLongSentence(
  sentence: string,
  maxWords: number
): string[] {
  const words = sentence.split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return [sentence];
  }
  const mid = Math.floor(words.length / 2);
  const conjunctions = new Set([
    "and",
    "but",
    "because",
    "so",
    "however",
    "therefore",
    "although"
  ]);
  let splitIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  words.forEach((word, index) => {
    const clean = word.replace(/[,;]/g, "").toLowerCase();
    if (word.endsWith(",") || conjunctions.has(clean)) {
      const distance = Math.abs(index - mid);
      if (distance < bestDistance) {
        bestDistance = distance;
        splitIndex = index;
      }
    }
  });
  if (splitIndex <= 0 || splitIndex >= words.length - 1) {
    splitIndex = mid;
  }
  const first = words.slice(0, splitIndex + 1).join(" ").replace(/[,;]+$/, "");
  const second = words.slice(splitIndex + 1).join(" ");
  return [ensureSentenceEnding(first), ensureSentenceEnding(second)];
}

function fnv1a(seed: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createPrng(seed: string) {
  let state = fnv1a(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function applySynonyms(text: string, seed: string, rate: number) {
  const substitutions: Array<[string, string]> = [
    ["important", "key"],
    ["common", "typical"],
    ["fast", "quick"],
    ["ensure", "make sure"],
    ["help", "assist"]
  ];
  const maxSubstitutions = Math.max(1, Math.floor(text.length / 140));
  let used = 0;
  const rng = createPrng(seed);
  const tokens = text.split(/\b/);
  const replaced = tokens.map((token) => {
    const lower = token.toLowerCase();
    const match = substitutions.find(([from]) => from === lower);
    if (!match) {
      return token;
    }
    if (used >= maxSubstitutions || rng() > rate) {
      return token;
    }
    used += 1;
    return applyCase(token, match[1]);
  });
  return replaced.join("");
}


function ensureSentenceEnding(line: string) {
  if (!line) {
    return line;
  }
  if (/[.!?]$/.test(line)) {
    return line;
  }
  return `${line}.`;
}

export function cleanupScript(input: {
  text: string;
  seed: string;
  config?: CleanupConfig;
}): CleanupResult {
  const warnings: string[] = [];
  const raw = input.text ?? "";
  const originalChars = raw.length;
  const config = { ...DEFAULT_CONFIG, ...input.config };
  let normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      cleanedText: "",
      warnings: ["empty_input"],
      stats: { originalChars, cleanedChars: 0, sentenceCount: 0 }
    };
  }

  warnings.push(...detectWarnings(normalized));

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const processedParagraphs: string[] = [];
  let sentenceCount = 0;

  for (const paragraph of paragraphs) {
    const lines = paragraph.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const expandedLines = lines.map((line) => {
      const isBullet = detectBullet(line);
      const stripped = isBullet ? stripBullet(line) : line;
      let content = normalizeSpacing(stripped);
      content = repairSplitWords(content);
      if (!content) {
        return "";
      }
      if (config.expandAbbreviations) {
        content = expandAbbreviations(content, config.abbreviations);
      }
      if (isBullet) {
        if (!hasVerb(content)) {
          content = `Key point: ${content}`;
        }
        warnings.push("bullets_normalized");
      }
      return ensureSentenceEnding(content);
    });

    const sentences: string[] = [];
    expandedLines.forEach((line) => {
      if (!line) {
        return;
      }
      const splits = splitIntoSentences(line);
      splits.forEach((sentence) => {
        const normalizedSentence = normalizeSpacing(sentence);
        splitLongSentence(normalizedSentence, config.maxWordsPerSentence).forEach((chunk) => {
          sentences.push(normalizeSpacing(chunk));
        });
      });
    });

    if (config.synonymSubstitutions) {
      const joined = sentences.join(" ");
      const substituted = applySynonyms(joined, input.seed, config.substitutionRate);
      const replaced = splitIntoSentences(substituted);
      processedParagraphs.push(replaced.join(" "));
      sentenceCount += replaced.length;
    } else {
      processedParagraphs.push(sentences.join(" "));
      sentenceCount += sentences.length;
    }
  }

  let cleaned = processedParagraphs.join(config.addPauses ? "\n\n" : " ");
  cleaned = normalizeSpacing(cleaned);
  cleaned = repairSplitWords(cleaned);
  const cleanedChars = cleaned.length;
  if (cleanedChars > config.maxLineChars * 6) {
    warnings.push("long_script");
  }

  return {
    cleanedText: cleaned,
    warnings,
    stats: { originalChars, cleanedChars, sentenceCount }
  };
}

export function reflowCaptionText(input: {
  text: string;
  maxLineChars: number;
}): string {
  const maxLineChars = Math.max(10, input.maxLineChars);
  let normalized = normalizeSpacing(input.text);
  normalized = repairSplitWords(normalized);
  if (!normalized) {
    return "";
  }
  const words = normalized.split(" ");
  const repaired: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const current = words[i];
    const next = words[i + 1];
    if (
      next &&
      /^[A-Z]{1,2}$/.test(current) &&
      /^[a-z]{2,}$/.test(next)
    ) {
      repaired.push(`${current}${next}`);
      i += 1;
      continue;
    }
    repaired.push(current);
  }

  const finalWords = repaired.filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of finalWords) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + word.length + 1 <= maxLineChars) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) {
    lines.push(current);
  }
  return lines.join("\n");
}
