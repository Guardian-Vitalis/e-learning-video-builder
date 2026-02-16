import { randomUUID } from "crypto";

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
  upstream?: string;
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

export async function POST(req: Request) {
  const requestId = randomUUID();
  if (!req.body) {
    return jsonError(
      400,
      { code: "missing_body", message: "Request body is required." },
      requestId
    );
  }

  const upstreamUrl = `${resolveUpstreamBaseUrl()}/v1/import/docx`;
  let upstreamResponse: Response;
  try {
    const headers = new Headers();
    const contentType = req.headers.get("content-type");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    headers.set("x-request-id", requestId);
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: req.body,
      duplex: "half"
    });
  } catch (err) {
    return jsonError(
      502,
      {
        code: "upstream_unreachable",
        message: "Could not reach preview generator",
        upstream: "cloud",
        upstreamUrl,
        cause: captureCause(err)
      },
      requestId
    );
  }

  const text = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const parsedBody = isJson && text ? safeJsonParse(text) : null;

  if (upstreamResponse.ok && isJson) {
    return new Response(text, {
      status: upstreamResponse.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!upstreamResponse.ok) {
    return jsonError(
      upstreamResponse.status,
      {
        code: "upstream_error",
        message: "Preview generator error.",
        upstream: "cloud",
        upstreamUrl,
        upstreamStatus: upstreamResponse.status,
        upstreamBody: parsedBody ?? text.slice(0, 48 * 1024)
      },
      requestId
    );
  }

  return jsonError(
    502,
    {
      code: "upstream_bad_response",
      message: "Preview generator returned non-JSON response.",
      upstream: "cloud",
      upstreamUrl,
      upstreamStatus: upstreamResponse.status,
      upstreamBody: text.slice(0, 48 * 1024)
    },
    requestId
  );
}
