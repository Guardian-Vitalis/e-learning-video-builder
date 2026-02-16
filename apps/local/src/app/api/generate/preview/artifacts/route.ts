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
  sectionId?: string;
  clipId?: string;
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
          sectionId: clip.sectionId,
          clipId: clip.id,
          mp4Path: clip.mp4Path,
          vttPath: clip.vttPath,
          srtPath: clip.srtPath
        });
      }
    }
  }
  return items;
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return jsonError(
      400,
      { code: "missing_job_id", message: "jobId is required." },
      requestId
    );
  }

  const upstreamBase = resolveUpstreamBaseUrl();
  const jobUrl = `${upstreamBase}/v1/jobs/${encodeURIComponent(jobId)}`;

  try {
    const jobRes = await fetch(jobUrl, { cache: "no-store" });
    const jobText = await jobRes.text();
    const jobContentType = jobRes.headers.get("content-type") ?? "";
    const jobIsJson = jobContentType.includes("application/json");
    const jobBody = jobIsJson ? safeJsonParse(jobText) : null;

    if (!jobRes.ok) {
      return jsonError(
        jobRes.status,
        {
          code: jobRes.status === 404 ? "upstream_not_found" : "upstream_error",
          message: "Preview generator status error.",
          upstreamUrl: jobUrl,
          upstreamStatus: jobRes.status,
          upstreamBody: jobBody ?? jobText.slice(0, 2000)
        },
        requestId
      );
    }

    if (!jobIsJson || !jobBody || typeof jobBody !== "object") {
      return jsonError(
        502,
        {
          code: "upstream_bad_response",
          message: "Preview generator returned non-JSON response.",
          upstreamUrl: jobUrl,
          upstreamStatus: jobRes.status,
          upstreamBody: jobText.slice(0, 2000)
        },
        requestId
      );
    }

    const job = jobBody as JobRecord;
    if (job.status !== "succeeded") {
      return jsonError(
        409,
        { code: "not_ready", message: "Preview artifacts not ready yet." },
        requestId
      );
    }

    const artifacts: ArtifactItem[] = [];
    if (job.artifacts?.manifestPath) {
      try {
        const manifestUrl = `${upstreamBase}${job.artifacts.manifestPath}`;
        const manifestRes = await fetch(manifestUrl, { cache: "no-store" });
        if (manifestRes.ok) {
          const manifest = (await manifestRes.json()) as JobArtifactsManifest;
          artifacts.push(...buildArtifactsFromManifest(manifest));
        }
      } catch {
        // ignore manifest fetch errors
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

    return jsonResponse(200, { jobId, artifacts, count: artifacts.length });
  } catch (err) {
    return jsonError(
      502,
      {
        code: "upstream_unreachable",
        message: "Could not reach preview generator.",
        upstreamUrl: jobUrl,
        cause: captureCause(err)
      },
      requestId
    );
  }
}
