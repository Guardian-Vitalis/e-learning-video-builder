export type LocalAvatarDoctorResponse = {
  ok: boolean;
  mode: string;
  actionItems?: string[];
  resolved?: {
    repoDir?: string | null;
    modelsDir?: string | null;
    python?: string | null;
    ffmpegPath?: string | null;
    envFilesLoaded?: string[];
  };
  musetalk?: {
    repoDirExists?: boolean;
    python?: { ok?: boolean; version?: string; exe?: string | null; stderr?: string | null; error?: string | null };
    torch?: { ok?: boolean; version?: string | null; cudaAvailable?: boolean };
    mmlabImports?: Record<string, { ok?: boolean; version?: string | null }>;
    ffmpeg?: { ok?: boolean; path?: string | null };
    models?: { missing?: string[]; present?: string[] };
  };
  cache?: { preparedAvatars?: number };
};

const DEFAULT_ENGINE_URL =
  process.env.NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL ?? "http://localhost:5600";
const PREVIEW_CLOUD_BASE_URL = process.env.NEXT_PUBLIC_CLOUD_API_BASE_URL ?? "";
const PREVIEW_CLOUD_ORIGIN = (() => {
  try {
    return PREVIEW_CLOUD_BASE_URL ? new URL(PREVIEW_CLOUD_BASE_URL).origin : null;
  } catch {
    return null;
  }
})();
const CLOUD_PROXY_PATH = "/api/cloud-proxy";

export function getLocalAvatarEngineUrl(engineUrl?: string) {
  return (engineUrl ?? DEFAULT_ENGINE_URL).replace(/\/$/, "");
}

function resolveMp4FetchUrl(mp4Url: string) {
  if (!mp4Url) {
    return mp4Url;
  }
  if (typeof window === "undefined") {
    return mp4Url;
  }
  let targetUrl: URL;
  try {
    targetUrl = new URL(mp4Url);
  } catch {
    return mp4Url;
  }
  const cloudOrigin = PREVIEW_CLOUD_ORIGIN;
  if (!cloudOrigin) {
    return mp4Url;
  }
  if (targetUrl.origin !== cloudOrigin) {
    return mp4Url;
  }
  if (targetUrl.origin === window.location.origin) {
    return mp4Url;
  }
  return `${CLOUD_PROXY_PATH}?url=${encodeURIComponent(mp4Url)}`;
}

export async function fetchLocalAvatarDoctor(engineUrl?: string) {
  const baseUrl = getLocalAvatarEngineUrl(engineUrl);
  const res = await fetch(`${baseUrl}/health/local-avatar`);
  if (!res.ok) {
    const body = await res.text();
    throw new LocalAvatarEngineError("Local engine health check failed", res.status, body);
  }
  return (await res.json()) as LocalAvatarDoctorResponse;
}

export function dataUrlToBase64(dataUrl: string) {
  const pngPrefix = "data:image/png;base64,";
  if (dataUrl.startsWith(pngPrefix)) {
    return dataUrl.slice(pngPrefix.length);
  }
  return dataUrl;
}

export function mp4Base64ToObjectUrl(mp4Base64: string) {
  const binary = atob(mp4Base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    array[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([array], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}

type EngineBaseParams = {
  engineUrl?: string;
};

export class LocalAvatarEngineError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(`${message} (status ${status})`);
    this.name = "LocalAvatarEngineError";
    this.status = status;
    this.body = body;
  }
}

export type PrepareAvatarJobRequest = {
  jobId: string;
  clipId: string;
  avatarId?: string;
  imagePngBase64: string;
  audioBase64: string;
  audioMime: string;
  fps?: number;
  bboxShift?: number;
  preparationHint?: string;
};

export type PrepareAvatarJobStatus = {
  status: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  cacheHit?: boolean;
  prepKey?: string | null;
  error?: string;
};

export type PrepareAvatarArtifacts = {
  mp4Base64: string;
  durationMs: number;
  preparedDir?: string;
};

export async function submitPrepareAvatarJob(params: PrepareAvatarJobRequest & EngineBaseParams) {
  const { jobId, clipId, imagePngBase64, audioBase64, audioMime, fps, bboxShift, preparationHint, avatarId } = params;
  const baseUrl = getLocalAvatarEngineUrl(params.engineUrl);
  const res = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jobId,
      clipId,
      avatarId,
      imagePngBase64,
      audioBase64,
      audioMime,
      fps,
      bboxShift,
      preparationHint
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new LocalAvatarEngineError("Prepare job submit failed", res.status, text);
  }
  return res.json();
}

export async function pollPrepareAvatarJobStatus(params: {
  jobId: string;
  clipId: string;
  engineUrl?: string;
  intervalMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: PrepareAvatarJobStatus) => void;
}): Promise<PrepareAvatarJobStatus> {
  const { jobId, clipId, engineUrl, intervalMs = 1200, signal, onStatus } = params;
  const baseUrl = getLocalAvatarEngineUrl(engineUrl);
  const endpoint = `${baseUrl}/v1/jobs/${jobId}/${clipId}/status`;
  const check = async (): Promise<PrepareAvatarJobStatus> => {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const res = await fetch(endpoint, { signal });
    if (!res.ok) {
      const text = await res.text();
      throw new LocalAvatarEngineError("Status fetch failed", res.status, text);
    }
    const payload = (await res.json()) as PrepareAvatarJobStatus;
    onStatus?.(payload);
    if (payload.status === "queued" || payload.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      return check();
    }
    return payload;
  };
  return check();
}

export async function fetchPrepareAvatarArtifacts(params: {
  jobId: string;
  clipId: string;
  engineUrl?: string;
}): Promise<PrepareAvatarArtifacts> {
  const { jobId, clipId, engineUrl } = params;
  const baseUrl = resolveEngineUrl(engineUrl);
  const res = await fetch(`${baseUrl}/v1/jobs/${jobId}/${clipId}/artifacts`);
  if (!res.ok) {
    const text = await res.text();
    throw new LocalAvatarEngineError("Artifacts fetch failed", res.status, text);
  }
  return (await res.json()) as PrepareAvatarArtifacts;
}

export type RunOneClipParams = {
  jobId: string;
  clipId: string;
  avatarId?: string;
  imagePngBase64: string;
  audioWavBase64: string;
  fps?: number;
  bboxShift?: number;
  preparationHint?: string;
  engineUrl?: string;
  signal?: AbortSignal;
  onStatus?: (status: PrepareAvatarJobStatus) => void;
  intervalMs?: number;
};

export async function runOneClipToMp4Base64(params: RunOneClipParams) {
  const {
    jobId,
    clipId,
    audioWavBase64,
    signal,
    engineUrl,
    onStatus,
    intervalMs,
    ...rest
  } = params;
  await submitPrepareAvatarJob({
    jobId,
    clipId,
    audioBase64: audioWavBase64,
    audioMime: "audio/wav",
    engineUrl,
    ...rest
  });
  const status = await pollPrepareAvatarJobStatus({
    jobId,
    clipId,
    engineUrl,
    signal,
    onStatus,
    intervalMs
  });
  if (status.status !== "succeeded") {
    throw new Error(`Clip ${clipId} did not succeed (${status.status})${status.error ? ": " + status.error : ""}`);
  }
  const artifacts = await fetchPrepareAvatarArtifacts({ jobId, clipId, engineUrl });
  return {
    mp4Base64: artifacts.mp4Base64,
    cacheHit: status.cacheHit,
    prepKey: status.prepKey ?? null
  };
}

export type RunLocalAvatarClipParams = {
  jobId: string;
  clipId: string;
  avatarId?: string;
  imagePngDataUrl: string;
  audioWavBase64: string;
  fps?: number;
  bboxShift?: number;
  preparationHint?: string;
  engineUrl?: string;
  signal?: AbortSignal;
  onStatus?: (status: PrepareAvatarJobStatus) => void;
  intervalMs?: number;
};

export async function runLocalAvatarClip(params: RunLocalAvatarClipParams) {
  const {
    jobId,
    clipId,
    imagePngDataUrl,
    audioWavBase64,
    signal,
    engineUrl,
    onStatus,
    intervalMs,
    ...rest
  } = params;
  return runOneClipToMp4Base64({
    jobId,
    clipId,
    imagePngBase64: dataUrlToBase64(imagePngDataUrl),
    audioWavBase64,
    signal,
    engineUrl,
    onStatus,
    intervalMs,
    ...rest
  });
}

function buildBase64Key(base64: string) {
  return `b64:${base64.length}:${base64.slice(0, 32)}`;
}

export async function ensureClipAudioWavBase64(args: {
  clipId: string;
  clip: { mp4Url?: string };
  signal?: AbortSignal;
  overrideWavBase64?: string;
  overrideSourceKey?: string;
}): Promise<{ wavBase64: string; sourceKey: string }> {
  const { clipId, clip, signal, overrideWavBase64, overrideSourceKey } = args;
  if (signal?.aborted) {
    throw new Error("aborted");
  }
  if (overrideWavBase64) {
    const sourceKey = overrideSourceKey ?? buildBase64Key(overrideWavBase64);
    setCachedWav(clipId, sourceKey, overrideWavBase64);
    return { wavBase64: overrideWavBase64, sourceKey };
  }
  if (!clip.mp4Url) {
    throw new Error(
      "No clip MP4 preview found. Run Cloud Generate first (to produce MP4 previews) OR upload Override audio (WAV) for this clip."
    );
  }
  const fetchUrl = resolveMp4FetchUrl(clip.mp4Url);
  const sourceKey = `url:${fetchUrl}`;
  const cached = getCachedWav(clipId, sourceKey);
  if (cached) {
    return { wavBase64: cached, sourceKey };
  }
  const res = await fetch(fetchUrl, { signal });
  if (!res.ok) {
    throw new Error(`Audio fetch failed (status ${res.status}).`);
  }
  const bytes = await res.arrayBuffer();
  if (signal?.aborted) {
    throw new Error("aborted");
  }
  const wavBase64 = await deriveWavBase64FromAudioBytes({
    bytes,
    mime: res.headers.get("Content-Type") ?? undefined
  });
  setCachedWav(clipId, sourceKey, wavBase64);
  return { wavBase64, sourceKey };
}

export function runLocalAvatarEngineSmokeTest() {
  console.log("Local Avatar Engine smoke test available via runOneClipToMp4Base64.");
}
import { deriveWavBase64FromAudioBytes } from "./audio/deriveWavBase64";
import { getCachedWav, setCachedWav } from "./audio/audioWavCache";
