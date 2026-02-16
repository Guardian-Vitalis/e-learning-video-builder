import { randomUUID } from "crypto";

export const runtime = "nodejs";

const UPSTREAM_BASE = "http://127.0.0.1:4000";
const TIMEOUT_MS = 30000;

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
  upstreamStatus?: number;
  upstreamBody?: unknown;
  detail?: string;
};

function jsonError(status: number, error: ErrorPayload, requestId: string) {
  return jsonResponse(status, { error, requestId });
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  let payload: unknown;
  try {
    payload = await req.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(
      400,
      { code: "invalid_json", message },
      requestId
    );
  }

  const upstreamUrl = `${UPSTREAM_BASE}/v1/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
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
          upstream: upstreamUrl,
          upstreamStatus: upstreamResponse.status,
          upstreamBody: parsedBody ?? text.slice(0, 2000)
        },
        requestId
      );
    }

    return jsonError(
      502,
      {
        code: "upstream_non_json",
        message: "Preview generator returned non-JSON response.",
        upstream: upstreamUrl,
        upstreamStatus: upstreamResponse.status,
        upstreamBody: text.slice(0, 2000)
      },
      requestId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(
      502,
      {
        code: "cloud_unreachable",
        message: "Could not reach preview generator",
        detail: message,
        upstream: upstreamUrl
      },
      requestId
    );
  } finally {
    clearTimeout(timer);
  }
}
