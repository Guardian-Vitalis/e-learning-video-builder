import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import type { JobRecord } from "@evb/shared";

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

  const upstreamUrl = `${resolveUpstreamBaseUrl()}/v1/jobs/${encodeURIComponent(jobId)}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, { cache: "no-store" });
    const text = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const parsedBody = isJson && text ? safeJsonParse(text) : null;

    if (!upstreamResponse.ok) {
      const code =
        upstreamResponse.status === 404 ? "upstream_not_found" : "upstream_error";
      return jsonError(
        upstreamResponse.status,
        {
          code,
          message: "Preview generator status error.",
          upstreamUrl,
          upstreamStatus: upstreamResponse.status,
          upstreamBody: parsedBody ?? text.slice(0, 2000)
        },
        requestId
      );
    }

    if (!isJson || !parsedBody || typeof parsedBody !== "object") {
      return jsonError(
        502,
        {
          code: "upstream_bad_response",
          message: "Preview generator returned non-JSON response.",
          upstreamUrl,
          upstreamStatus: upstreamResponse.status,
          upstreamBody: text.slice(0, 2000)
        },
        requestId
      );
    }

    const job = parsedBody as JobRecord;
    return jsonResponse(200, {
      jobId: job.id ?? jobId,
      state: job.status ?? "unknown",
      progress: job.progress
        ? { phase: job.progress.phase, pct: job.progress.pct }
        : undefined,
      message: job.error?.message,
      artifactsReady: job.status === "succeeded" && Boolean(job.artifacts),
      status: job
    });
  } catch (err) {
    return jsonError(
      502,
      {
        code: "upstream_unreachable",
        message: "Could not reach preview generator.",
        upstreamUrl,
        cause: captureCause(err)
      },
      requestId
    );
  }
}
