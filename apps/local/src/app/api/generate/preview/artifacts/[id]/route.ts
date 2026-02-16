import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import type { JobArtifactsManifest, JobRecord } from "@evb/shared";

export const runtime = "nodejs";

const DEFAULT_UPSTREAM_BASE = "http://localhost:4000";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

type ErrorPayload = {
  code: string;
  message: string;
  upstreamUrl?: string;
  upstreamStatus?: number;
  upstreamBody?: unknown;
  cause?: Record<string, unknown>;
};

function jsonError(status: number, error: ErrorPayload, requestId: string) {
  return jsonResponse(status, { error, requestId });
}

function resolveUpstreamBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_CLOUD_API_BASE_URL || DEFAULT_UPSTREAM_BASE;
  return raw.replace(/\/$/, "");
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function captureCause(err: unknown) {
  const base = (err as { cause?: unknown })?.cause ?? err;
  if (!base || typeof base !== "object") {
    return { message: String(base ?? "") };
  }
  const record = base as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  if (typeof record.message === "string") payload.message = record.message;
  if (typeof record.code === "string") payload.code = record.code;
  if (typeof record.errno === "string" || typeof record.errno === "number") {
    payload.errno = record.errno;
  }
  if (typeof record.syscall === "string") payload.syscall = record.syscall;
  return payload;
}

type ArtifactItem = {
  id: string;
  kind: "clip" | "primary";
  mp4Path: string;
  vttPath?: string;
  srtPath?: string;
};

function buildArtifactsFromManifest(manifest: JobArtifactsManifest): ArtifactItem[] {
  const items: ArtifactItem[] = [];
  for (const section of manifest.sections ?? []) {
    for (const variation of section.variations ?? []) {
      for (const clip of variation.clips ?? []) {
        if (!clip.id || !clip.mp4Path) {
          continue;
        }
        items.push({
          id: clip.id,
          kind: "clip",
          mp4Path: clip.mp4Path,
          vttPath: clip.vttPath,
          srtPath: clip.srtPath
        });
      }
    }
  }
  return items;
}

async function resolveArtifacts(jobId: string, upstreamBase: string) {
  const jobUrl = `${upstreamBase}/v1/jobs/${encodeURIComponent(jobId)}`;
  const jobRes = await fetch(jobUrl, { cache: "no-store" });
  const jobText = await jobRes.text();
  const contentType = jobRes.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const jobBody = isJson ? safeJsonParse(jobText) : null;
  if (!jobRes.ok) {
    return {
      ok: false as const,
      status: jobRes.status,
      error: {
        code: jobRes.status === 404 ? "upstream_not_found" : "upstream_error",
        message: "Preview generator status error.",
        upstreamUrl: jobUrl,
        upstreamStatus: jobRes.status,
        upstreamBody: jobBody ?? jobText.slice(0, 2000)
      }
    };
  }
  if (!isJson || !jobBody || typeof jobBody !== "object") {
    return {
      ok: false as const,
      status: 502,
      error: {
        code: "upstream_bad_response",
        message: "Preview generator returned non-JSON response.",
        upstreamUrl: jobUrl,
        upstreamStatus: jobRes.status,
        upstreamBody: jobText.slice(0, 2000)
      }
    };
  }

  const job = jobBody as JobRecord;
  if (job.status !== "succeeded") {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: "not_ready",
        message: "Preview artifacts not ready yet."
      }
    };
  }
  const artifacts: ArtifactItem[] = [];
  if (job.artifacts?.manifestPath) {
    const manifestUrl = `${upstreamBase}${job.artifacts.manifestPath}`;
    const manifestRes = await fetch(manifestUrl, { cache: "no-store" });
    if (manifestRes.ok) {
      const manifest = (await manifestRes.json()) as JobArtifactsManifest;
      artifacts.push(...buildArtifactsFromManifest(manifest));
    }
  }
  if (artifacts.length === 0 && job.artifacts?.mp4Path) {
    artifacts.push({
      id: "primary",
      kind: "primary",
      mp4Path: job.artifacts.mp4Path,
      vttPath: job.artifacts.vttPath,
      srtPath: job.artifacts.srtPath
    });
  }

  return { ok: true as const, jobUrl, artifacts };
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  const requestId = randomUUID();
  const jobId = req.nextUrl.searchParams.get("jobId");
  const artifactId = context.params.id;
  const kind = req.nextUrl.searchParams.get("kind") ?? "mp4";

  if (!jobId) {
    return jsonError(
      400,
      { code: "missing_job_id", message: "jobId is required." },
      requestId
    );
  }
  if (!artifactId) {
    return jsonError(
      400,
      { code: "missing_artifact_id", message: "artifact id is required." },
      requestId
    );
  }
  if (!["mp4", "vtt", "srt"].includes(kind)) {
    return jsonError(
      400,
      { code: "invalid_artifact_kind", message: "Invalid artifact kind." },
      requestId
    );
  }

  const upstreamBase = resolveUpstreamBaseUrl();

  try {
    const resolved = await resolveArtifacts(jobId, upstreamBase);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.error, requestId);
    }

    const artifact = resolved.artifacts.find((item) => item.id === artifactId);
    const artifactPath =
      kind === "vtt"
        ? artifact?.vttPath
        : kind === "srt"
          ? artifact?.srtPath
          : artifact?.mp4Path;
    if (!artifactPath) {
      return jsonError(
        404,
        { code: "artifact_not_found", message: "Artifact not found." },
        requestId
      );
    }
    if (!artifactPath.startsWith("/")) {
      return jsonError(
        400,
        { code: "invalid_artifact_path", message: "Invalid artifact path." },
        requestId
      );
    }

    const upstreamUrl = `${upstreamBase}${artifactPath}`;
    const headers = new Headers();
    const range = req.headers.get("range");
    if (range) {
      headers.set("range", range);
    }
    const ifRange = req.headers.get("if-range");
    if (ifRange) {
      headers.set("if-range", ifRange);
    }

    const upstreamRes = await fetch(upstreamUrl, { headers });
    let contentType = upstreamRes.headers.get("content-type") ?? "";
    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      return jsonError(
        upstreamRes.status,
        {
          code: "upstream_error",
          message: "Preview generator artifact error.",
          upstreamUrl,
          upstreamStatus: upstreamRes.status,
          upstreamBody: text.slice(0, 2000)
        },
        requestId
      );
    }

    if (!contentType && kind === "vtt") {
      contentType = "text/vtt; charset=utf-8";
    }
    if (!contentType && kind === "srt") {
      contentType = "application/x-subrip; charset=utf-8";
    }
    const passHeaders = new Headers();
    if (contentType) passHeaders.set("Content-Type", contentType);
    const contentLength = upstreamRes.headers.get("content-length");
    if (contentLength) passHeaders.set("Content-Length", contentLength);
    const acceptRanges = upstreamRes.headers.get("accept-ranges");
    if (acceptRanges) passHeaders.set("Accept-Ranges", acceptRanges);
    const contentRange = upstreamRes.headers.get("content-range");
    if (contentRange) passHeaders.set("Content-Range", contentRange);
    const etag = upstreamRes.headers.get("etag");
    if (etag) passHeaders.set("ETag", etag);
    const lastModified = upstreamRes.headers.get("last-modified");
    if (lastModified) passHeaders.set("Last-Modified", lastModified);
    passHeaders.set("Cache-Control", "no-store");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: passHeaders
    });
  } catch (err) {
    return jsonError(
      502,
      {
        code: "upstream_unreachable",
        message: "Could not reach preview generator.",
        cause: captureCause(err)
      },
      requestId
    );
  }
}
