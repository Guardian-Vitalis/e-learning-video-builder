export type LocalAvatarErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP_NON_2XX"
  | "INVALID_JSON"
  | "INVALID_SCHEMA";

export type LocalAvatarError = {
  name: "LocalAvatarError";
  code: LocalAvatarErrorCode;
  message: string;
  status?: number;
  details?: unknown;
};

export class LocalAvatarClientError extends Error {
  code: LocalAvatarErrorCode;
  status?: number;
  details?: unknown;

  constructor(
    code: LocalAvatarErrorCode,
    message: string,
    options?: { status?: number; details?: unknown }
  ) {
    super(message);
    this.name = "LocalAvatarClientError";
    this.code = code;
    this.status = options?.status;
    this.details = options?.details;
  }

  toLocalAvatarError(): LocalAvatarError {
    return {
      name: "LocalAvatarError",
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details
    };
  }
}

export type LocalAvatarJobSubmit = {
  jobId: string;
  clipId: string;
  imagePngBase64: string;
  audioWavBase64?: string;
  scriptText?: string;
  avatarId?: string;
  bboxShift?: number;
  preparationHint?: "auto" | "prefer_cached" | "force_prepare";
  width: number;
  height: number;
  fps?: number;
};

export type LocalAvatarStatus = {
  status: "queued" | "running" | "succeeded" | "failed";
  error?: string;
  cacheHit?: boolean;
  prepKey?: string | null;
};

export type LocalAvatarClientConfig = {
  baseUrl: string;
  timeoutMs: number;
  token?: string;
};

function makeUrl(baseUrl: string, pathSuffix: string) {
  const base = baseUrl.replace(/\/$/, "");
  const suffix = pathSuffix.startsWith("/") ? pathSuffix : `/${pathSuffix}`;
  return `${base}${suffix}`;
}

function makeBodySnippet(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= 200) {
    return trimmed;
  }
  return `${trimmed.slice(0, 200)}...`;
}

function parseJsonOrThrow(text: string) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new LocalAvatarClientError("INVALID_JSON", "Invalid JSON response");
  }
}

async function requestText(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new LocalAvatarClientError("TIMEOUT", `Request timed out after ${timeoutMs}ms`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new LocalAvatarClientError("NETWORK", message);
  } finally {
    clearTimeout(timeout);
  }
}

export function createLocalAvatarClient(config: LocalAvatarClientConfig) {
  const timeoutMs = Math.max(1, config.timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const healthCheck = async (): Promise<{ ok: boolean; name: "musetalk"; version?: string }> => {
    const url = makeUrl(config.baseUrl, "/health");
    const { status, ok, text } = await requestText(url, { method: "GET", headers }, timeoutMs);
    if (!ok) {
      throw new LocalAvatarClientError("HTTP_NON_2XX", `HTTP ${status}`, {
        status,
        details: makeBodySnippet(text)
      });
    }
    const parsed = parseJsonOrThrow(text) as { ok?: unknown; name?: unknown; version?: unknown };
    if ("name" in parsed && parsed.name !== "musetalk") {
      throw new LocalAvatarClientError("INVALID_SCHEMA", "Unexpected engine name", {
        details: parsed
      });
    }
    return {
      ok: Boolean(parsed.ok),
      name: "musetalk",
      version: typeof parsed.version === "string" ? parsed.version : undefined
    };
  };

  const submitClipJob = async (input: LocalAvatarJobSubmit): Promise<{ accepted: true }> => {
    const url = makeUrl(config.baseUrl, "/v1/jobs");
    const payload: LocalAvatarJobSubmit = {
      jobId: input.jobId,
      clipId: input.clipId,
      imagePngBase64: input.imagePngBase64,
      width: input.width,
      height: input.height,
      ...(input.audioWavBase64 ? { audioWavBase64: input.audioWavBase64 } : {}),
      ...(input.scriptText ? { scriptText: input.scriptText } : {}),
      ...(input.avatarId ? { avatarId: input.avatarId } : {}),
      ...(typeof input.bboxShift === "number" ? { bboxShift: input.bboxShift } : {}),
      ...(input.preparationHint ? { preparationHint: input.preparationHint } : {}),
      ...(typeof input.fps === "number" ? { fps: input.fps } : {})
    };
    const { status, ok, text } = await requestText(
      url,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      },
      timeoutMs
    );
    if (!ok) {
      throw new LocalAvatarClientError("HTTP_NON_2XX", `HTTP ${status}`, {
        status,
        details: makeBodySnippet(text)
      });
    }
    const parsed = parseJsonOrThrow(text) as { accepted?: unknown };
    if (parsed.accepted !== true) {
      throw new LocalAvatarClientError("INVALID_SCHEMA", "Missing accepted=true", {
        details: parsed
      });
    }
    return { accepted: true };
  };

  const pollClipStatus = async (jobId: string, clipId: string): Promise<LocalAvatarStatus> => {
    const url = makeUrl(config.baseUrl, `/v1/jobs/${jobId}/${clipId}/status`);
    const { status, ok, text } = await requestText(url, { method: "GET", headers }, timeoutMs);
    if (!ok) {
      throw new LocalAvatarClientError("HTTP_NON_2XX", `HTTP ${status}`, {
        status,
        details: makeBodySnippet(text)
      });
    }
    const parsed = parseJsonOrThrow(text) as {
      status?: unknown;
      error?: unknown;
      cacheHit?: unknown;
      prepKey?: unknown;
    };
    if (parsed.status !== "queued" && parsed.status !== "running" &&
        parsed.status !== "succeeded" && parsed.status !== "failed") {
      throw new LocalAvatarClientError("INVALID_SCHEMA", "Invalid status payload", {
        details: parsed
      });
    }
    let cacheHit: boolean | undefined;
    if (parsed.cacheHit !== undefined) {
      if (typeof parsed.cacheHit !== "boolean") {
        throw new LocalAvatarClientError("INVALID_SCHEMA", "Invalid cacheHit payload", {
          details: parsed
        });
      }
      cacheHit = parsed.cacheHit;
    }
    let prepKey: string | null | undefined;
    if (parsed.prepKey !== undefined) {
      if (typeof parsed.prepKey !== "string" && parsed.prepKey !== null) {
        throw new LocalAvatarClientError("INVALID_SCHEMA", "Invalid prepKey payload", {
          details: parsed
        });
      }
      prepKey = parsed.prepKey;
    }
    if (parsed.status === "failed") {
      if (parsed.error !== undefined && typeof parsed.error !== "string") {
        throw new LocalAvatarClientError("INVALID_SCHEMA", "Invalid error payload", {
          details: parsed
        });
      }
      return {
        status: "failed",
        error: parsed.error,
        ...(cacheHit !== undefined ? { cacheHit } : {}),
        ...(prepKey !== undefined ? { prepKey } : {})
      };
    }
    return {
      status: parsed.status,
      ...(cacheHit !== undefined ? { cacheHit } : {}),
      ...(prepKey !== undefined ? { prepKey } : {})
    };
  };

  const fetchClipArtifacts = async (
    jobId: string,
    clipId: string
  ): Promise<{ mp4Base64: string; durationMs?: number }> => {
    const url = makeUrl(config.baseUrl, `/v1/jobs/${jobId}/${clipId}/artifacts`);
    const { status, ok, text } = await requestText(url, { method: "GET", headers }, timeoutMs);
    if (!ok) {
      throw new LocalAvatarClientError("HTTP_NON_2XX", `HTTP ${status}`, {
        status,
        details: makeBodySnippet(text)
      });
    }
    const parsed = parseJsonOrThrow(text) as { mp4Base64?: unknown; durationMs?: unknown };
    if (!parsed.mp4Base64 || typeof parsed.mp4Base64 !== "string") {
      throw new LocalAvatarClientError("INVALID_SCHEMA", "Missing mp4Base64", {
        details: parsed
      });
    }
    if (parsed.durationMs !== undefined && typeof parsed.durationMs !== "number") {
      throw new LocalAvatarClientError("INVALID_SCHEMA", "Invalid durationMs", {
        details: parsed
      });
    }
    return {
      mp4Base64: parsed.mp4Base64,
      durationMs: parsed.durationMs
    };
  };

  return {
    healthCheck,
    submitClipJob,
    pollClipStatus,
    fetchClipArtifacts
  };
}
