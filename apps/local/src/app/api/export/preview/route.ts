import { randomUUID } from "crypto";
import JSZip from "jszip";
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
  details?: Record<string, unknown>;
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

function sanitizeName(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "clip";
}

type ClipArtifact = {
  id: string;
  baseName: string;
  mp4Path: string;
  vttPath?: string;
  srtPath?: string;
};

function buildArtifactsFromManifest(manifest: JobArtifactsManifest): ClipArtifact[] {
  const items: ClipArtifact[] = [];
  for (const section of manifest.sections ?? []) {
    for (const variation of section.variations ?? []) {
      for (const clip of variation.clips ?? []) {
        if (!clip.id || !clip.mp4Path) {
          continue;
        }
        const baseName = sanitizeName(`${section.sectionId}-${clip.id}`);
        items.push({
          id: clip.id,
          baseName,
          mp4Path: clip.mp4Path,
          vttPath: clip.vttPath,
          srtPath: clip.srtPath
        });
      }
    }
  }
  return items;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? safeJsonParse(text) : null;
  return { res, text, body };
}

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  const jobId = req.nextUrl.searchParams.get("jobId");
  const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
  const captionParam = req.nextUrl.searchParams.get("captionLanguage");
  const captionLanguage = captionParam === "fr" || captionParam === "en" ? captionParam : "en";
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
    const { res: jobRes, text: jobText, body: jobBody } = await fetchJson(jobUrl);
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
    if (!jobBody || typeof jobBody !== "object") {
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
    if (!job.artifacts) {
      return jsonError(
        409,
        { code: "artifacts_missing", message: "Preview artifacts are missing." },
        requestId
      );
    }

    let artifacts: ClipArtifact[] = [];
    if (job.artifacts.manifestPath) {
      const manifestUrl = `${upstreamBase}${job.artifacts.manifestPath}`;
      const manifestRes = await fetch(manifestUrl, { cache: "no-store" });
      if (manifestRes.ok) {
        const manifest = (await manifestRes.json()) as JobArtifactsManifest;
        artifacts = buildArtifactsFromManifest(manifest);
      }
    }
    if (artifacts.length === 0 && job.artifacts.mp4Path) {
      artifacts = [
        {
          id: "primary",
          baseName: "primary",
          mp4Path: job.artifacts.mp4Path,
          vttPath: job.artifacts.vttPath,
          srtPath: job.artifacts.srtPath
        }
      ];
    }

    if (artifacts.length === 0) {
      return jsonError(
        409,
        { code: "artifacts_missing", message: "No preview artifacts found." },
        requestId
      );
    }

    const zip = new JSZip();
    const files: Array<{ path: string; kind: string }> = [];
    const clipAssetsById: Record<
      string,
      {
        mp4: string;
        captions?: { lang: string; vtt?: string; srt?: string };
      }
    > = {};
    let captionAdded = false;

    for (const item of artifacts) {
      if (!item.mp4Path.startsWith("/")) {
        return jsonError(
          400,
          { code: "invalid_artifact_path", message: "Invalid artifact path." },
          requestId
        );
      }
      const mp4Url = `${upstreamBase}${item.mp4Path}`;
      const mp4Res = await fetch(mp4Url);
      if (!mp4Res.ok) {
        const text = await mp4Res.text();
        return jsonError(
          502,
          {
            code: "artifact_download_failed",
            message: "Failed to download MP4.",
            upstreamUrl: mp4Url,
            upstreamStatus: mp4Res.status,
            upstreamBody: text.slice(0, 2000)
          },
          requestId
        );
      }
      const mp4Buffer = await mp4Res.arrayBuffer();
      const mp4Name = `clips/${item.baseName}.mp4`;
      zip.file(mp4Name, mp4Buffer);
      files.push({ path: mp4Name, kind: "video/mp4" });
      clipAssetsById[item.id] = { mp4: mp4Name };

      if (item.vttPath && item.vttPath.startsWith("/")) {
        const vttUrl = `${upstreamBase}${item.vttPath}`;
        const vttRes = await fetch(vttUrl);
        if (vttRes.ok) {
          const vttText = await vttRes.text();
          const vttName = `captions/${item.baseName}.vtt`;
          zip.file(vttName, vttText);
          files.push({ path: vttName, kind: "text/vtt" });
          captionAdded = true;
          clipAssetsById[item.id].captions = {
            lang: captionLanguage,
            vtt: vttName
          };
        }
      }

      if (item.srtPath && item.srtPath.startsWith("/")) {
        const srtUrl = `${upstreamBase}${item.srtPath}`;
        const srtRes = await fetch(srtUrl);
        if (srtRes.ok) {
          const srtText = await srtRes.text();
          const srtName = `captions/${item.baseName}.srt`;
          zip.file(srtName, srtText);
          files.push({ path: srtName, kind: "text/srt" });
          captionAdded = true;
          const existing = clipAssetsById[item.id].captions ?? { lang: captionLanguage };
          clipAssetsById[item.id].captions = {
            ...existing,
            srt: srtName
          };
        }
      }
    }

    if (!captionAdded) {
      const note = "Captions were not available for this preview export.";
      zip.file("captions/README.txt", note);
      files.push({ path: "captions/README.txt", kind: "text/plain" });
    }

    zip.file(
      "manifest.json",
      JSON.stringify(
        {
          jobId,
          projectId,
          exportedAt: new Date().toISOString(),
          export: {
            captionLanguage
          },
          clipAssetsById,
          files
        },
        null,
        2
      )
    );

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const safeId = sanitizeName(projectId ?? jobId.slice(0, 8));
    return new Response(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=\"evb-preview-${safeId}.zip\"`,
        "Cache-Control": "no-store"
      }
    });
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
