export const PREVIEW_GENERATOR_ENV_KEY = "NEXT_PUBLIC_CLOUD_API_BASE_URL";
export const LOCAL_AVATAR_ENGINE_ENV_KEY = "NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL";

const PREVIEW_GENERATOR_STEPS = [
  "corepack yarn workspace @evb/cloud dev",
  "corepack yarn workspace @evb/local dev"
];

const PREVIEW_GENERATOR_MESSAGE =
  "MP4 previews are required to derive clip audio automatically (Local Avatar). Set NEXT_PUBLIC_CLOUD_API_BASE_URL=http://localhost:4000 in apps/local/.env.local.";
const PREVIEW_GENERATOR_STEPS_TEXT = PREVIEW_GENERATOR_STEPS.join("\n");
const PREVIEW_GENERATOR_DETAILS = [
  PREVIEW_GENERATOR_MESSAGE,
  "",
  "Steps:",
  PREVIEW_GENERATOR_STEPS_TEXT
].join("\n");

export function getPreviewGeneratorBaseUrl(): string | null {
  const raw = process.env[PREVIEW_GENERATOR_ENV_KEY];
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/$/, "");
}

export function getPreviewGeneratorUiHints() {
  const baseUrl = getPreviewGeneratorBaseUrl();
  return {
    configured: Boolean(baseUrl),
    baseUrl: baseUrl ?? undefined,
    title: "Preview generator not configured (local)",
    message: PREVIEW_GENERATOR_MESSAGE,
    details: PREVIEW_GENERATOR_DETAILS,
    steps: PREVIEW_GENERATOR_STEPS,
    stepsText: PREVIEW_GENERATOR_STEPS_TEXT,
    restartHint: PREVIEW_GENERATOR_STEPS[1]
  };
}

export type PreviewGeneratorRuntimeConfig = {
  previewGeneratorBaseUrl: string | null;
  localAvatarEngineUrl: string | null;
  source: "env_file" | "process_env" | "unset";
  candidatePaths: string[];
  chosenPath: string | null;
};

export async function fetchPreviewGeneratorRuntimeConfig(): Promise<PreviewGeneratorRuntimeConfig> {
  try {
    const res = await fetch(`/api/runtime-config?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      return { previewGeneratorBaseUrl: null, localAvatarEngineUrl: null, source: "error" };
    }
    return (await res.json()) as PreviewGeneratorRuntimeConfig;
  } catch {
    return { previewGeneratorBaseUrl: null, localAvatarEngineUrl: null, source: "error" };
  }
}
