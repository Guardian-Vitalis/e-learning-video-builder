import fs from "node:fs";
import path from "node:path";
import {
  LOCAL_AVATAR_ENGINE_ENV_KEY,
  PREVIEW_GENERATOR_ENV_KEY
} from "../config/previewGeneratorConfig";

export type RuntimeConfigSource = "env_file" | "process_env" | "unset";

const SEARCH_DEPTH = 6;

const PREVIEW_KEYS = [
  PREVIEW_GENERATOR_ENV_KEY,
  "CLOUD_API_BASE_URL"
];
const LOCAL_AVATAR_KEYS = [
  LOCAL_AVATAR_ENGINE_ENV_KEY,
  "EVB_LOCAL_AVATAR_ENGINE_URL",
  "LOCAL_AVATAR_ENGINE_URL"
];

function buildCandidatePaths() {
  const candidates: string[] = [];
  let current = process.cwd();
  for (let depth = 0; depth < SEARCH_DEPTH; depth += 1) {
    candidates.push(path.join(current, ".env.local"));
    candidates.push(path.join(current, ".env"));
    candidates.push(path.join(current, "apps", "local", ".env.local"));
    candidates.push(path.join(current, "apps", "local", ".env"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return candidates;
}

function sanitizePath(p: string): string {
  try {
    return path.resolve(p);
  } catch {
    return p;
  }
}

function stripInlineComment(value: string): { value: string; note?: string } {
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const prevChar = i === 0 ? "" : value[i - 1];
    const hasWhitespaceBefore = i === 0 || /\s/.test(prevChar);
    if ((char === "#" || char === ";") && hasWhitespaceBefore) {
      return {
        value: value.slice(0, i).trimEnd(),
        note: `inline comment stripped (${char})`
      };
    }
    if (
      char === "/" &&
      i + 1 < value.length &&
      value[i + 1] === "/" &&
      hasWhitespaceBefore
    ) {
      return {
        value: value.slice(0, i).trimEnd(),
        note: "inline comment stripped (//)"
      };
    }
  }
  return { value };
}

function stripQuotes(value: string): { value: string; note?: string } {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return { value: value.slice(1, -1), note: "quotes stripped" };
  }
  return { value };
}

function normalizeValue(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function readEnvFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8");
  const cleaned = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const entries: Record<string, string> = {};
  const parseNotes: string[] = [];
  cleaned.split(/\r?\n/).forEach((line) => {
    let trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("//")) {
      parseNotes.push("ignored comment line");
      return;
    }
    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.replace(/^export\s+/, "");
      parseNotes.push("export prefix removed");
    }
    const [keyPart, ...rest] = trimmed.split("=");
    if (!keyPart || rest.length === 0) {
      return;
    }
    const rawValue = rest.join("=");
    const commaStripped = rawValue.trim();
    let value = commaStripped;
    const inline = stripInlineComment(value);
    if (inline.note) {
      parseNotes.push(`${inline.note} for ${keyPart.trim()}`);
    }
    value = inline.value;
    if (value.endsWith(";")) {
      value = value.slice(0, -1).trimEnd();
      parseNotes.push(`trailing semicolon removed for ${keyPart.trim()}`);
    }
    const quoted = stripQuotes(value);
    if (quoted.note) {
      parseNotes.push(`${quoted.note} for ${keyPart.trim()}`);
    }
    value = quoted.value.trim();
    if (!value) {
      return;
    }
    entries[keyPart.trim()] = value;
  });
  return { entries, parseNotes };
}

function pickValue(
  source: Record<string, string | undefined>,
  keys: string[],
  parseNotes: string[],
  foundKeys: Record<string, boolean>
) {
  for (const key of keys) {
    const raw = source[key];
    if (raw === undefined) {
      continue;
    }
    foundKeys[key] = true;
    const normalized = normalizeValue(raw);
    if (!normalized) {
      parseNotes.push(`${key} is empty after trimming`);
      continue;
    }
    try {
      new URL(normalized);
      return normalized;
    } catch {
      parseNotes.push(`invalid URL for ${key}`);
      continue;
    }
  }
  return null;
}

export function resolveRuntimeConfig() {
  const candidatePaths = buildCandidatePaths().map(sanitizePath);
  let envEntries: Record<string, string> = {};
  let chosenPath: string | null = null;
  let parseNotes: string[] = [];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        const result = readEnvFile(candidate);
        envEntries = result.entries;
        parseNotes = result.parseNotes;
        chosenPath = candidate;
        break;
      } catch {
        continue;
      }
    }
  }
  const foundKeys: Record<string, boolean> = {};
  [...PREVIEW_KEYS, ...LOCAL_AVATAR_KEYS].forEach((key) => {
    foundKeys[key] = false;
  });
  const previewFromFile = pickValue(envEntries, PREVIEW_KEYS, parseNotes, foundKeys);
  const localFromFile = pickValue(envEntries, LOCAL_AVATAR_KEYS, parseNotes, foundKeys);
  const previewFromEnv = pickValue(process.env as Record<string, string | undefined>, PREVIEW_KEYS, parseNotes, foundKeys);
  const localFromEnv = pickValue(process.env as Record<string, string | undefined>, LOCAL_AVATAR_KEYS, parseNotes, foundKeys);
  let source: RuntimeConfigSource = "unset";
  if (previewFromFile || localFromFile) {
    source = "env_file";
  } else if (previewFromEnv || localFromEnv) {
    source = "process_env";
  }
  return {
    previewGeneratorBaseUrl: previewFromFile ?? previewFromEnv ?? null,
    localAvatarEngineUrl: localFromFile ?? localFromEnv ?? null,
    source,
    candidatePaths,
    chosenPath,
    parseNotes,
    foundKeys
  };
}
