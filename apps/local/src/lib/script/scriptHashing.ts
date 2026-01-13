type HashAlgo = "sha256" | undefined;

function normalizeText(text: string) {
  return text.trim().replace(/\r\n/g, "\n");
}

function normalizeWhitespace(text: string) {
  return normalizeText(text).replace(/\s+/g, " ");
}

export function splitIntoSentences(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }
  const matches = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!matches) {
    return [];
  }
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function getSubtleCrypto(): SubtleCrypto | null {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  try {
    const req = (0, eval)("require") as (id: string) => any;
    const nodeCrypto = req("crypto") as { webcrypto?: { subtle?: SubtleCrypto } };
    return nodeCrypto.webcrypto?.subtle ?? null;
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const normalized = normalizeText(text);
  const subtle = getSubtleCrypto();
  if (!subtle || typeof TextEncoder === "undefined") {
    throw new Error("sha256 unavailable");
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildScriptHashMetadata(text: string, algo: HashAlgo) {
  const scriptHash = await sha256Hex(text);
  const sentences = splitIntoSentences(text);
  const sentenceHashes = await Promise.all(
    sentences.map(async (sentence) => sha256Hex(sentence))
  );
  return {
    scriptHash,
    sentenceHashes,
    algo: algo ?? "sha256"
  };
}

export async function computeSentenceDiff(
  approvedSentenceHashes: string[],
  currentText: string
): Promise<{ changedSentences: number; currentSentenceHashes: string[] }> {
  const currentSentences = splitIntoSentences(currentText);
  const currentHashes = await Promise.all(
    currentSentences.map(async (sentence) => sha256Hex(sentence))
  );
  const max = Math.max(approvedSentenceHashes.length, currentHashes.length);
  let changed = 0;
  for (let i = 0; i < max; i += 1) {
    if (approvedSentenceHashes[i] !== currentHashes[i]) {
      changed += 1;
    }
  }
  return { changedSentences: changed, currentSentenceHashes: currentHashes };
}
