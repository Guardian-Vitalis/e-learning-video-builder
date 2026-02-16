function reflowCaptionText(input, maxLen = 42) {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + (line ? " " : "") + w).length > maxLen) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = line ? (line + " " + w) : w;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// Stub "cleanupScript": deterministic, local-only, no LLM.
// Returns an object with multiple common field names so UI code is unlikely to crash
// regardless of what it expects (outputText/cleanedText/text/etc).
function cleanupScript(args = {}) {
  const original = String(args.text ?? "");
  const cleaned = original
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .join("\n")
    .trim();

  return {
    mode: "stub",
    seed: args.seed ?? null,
    config: args.config ?? null,

    inputText: original,
    outputText: cleaned,
    cleanedText: cleaned,
    text: cleaned,

    warnings: ["cleanupScript is stubbed (@evb/shared)"],
    changes: []
  };
}

const StubAvatarStyle = Object.freeze({
  SIMPLE: "SIMPLE",
  REALISTIC: "REALISTIC"
});

const StubBackgroundStyle = Object.freeze({
  PLAIN: "PLAIN",
  GRADIENT: "GRADIENT"
});

const ProjectStatus = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  RUNNING: "RUNNING",
  DONE: "DONE",
  ERROR: "ERROR"
});

function getAvatarPreset(key = "default") {
  return {
    key,
    label: String(key),
    avatarStyle: StubAvatarStyle.SIMPLE,
    backgroundStyle: StubBackgroundStyle.PLAIN
  };
}

module.exports = {
  SHARED_VERSION: "0.0.0",

  // runtime helpers used by apps
  reflowCaptionText,
  cleanupScript,
  getAvatarPreset,

  // enums/constants used by UI
  StubAvatarStyle,
  StubBackgroundStyle,
  ProjectStatus,

  // placeholders so “import { X } from @evb/shared” doesn’t break bundling
  ApprovedManifest: {},
  DraftManifest: {},
  CourseVideoProject: {},
  GenerationSettings: {},
  CleanupResult: {},
  DraftSection: {},
  TableImageAttachment: {},
  DocxMeta: {},
  JobRecord: {},
  JobSectionProgress: {},
  JobArtifacts: {},
  JobArtifactsManifest: {},
  HealthResponse: {}
};
