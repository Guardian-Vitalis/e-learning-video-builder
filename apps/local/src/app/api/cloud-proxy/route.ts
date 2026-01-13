import { NextRequest, NextResponse } from "next/server";
import { resolveRuntimeConfig } from "../../../lib/runtime/runtimeEnv";

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const runtimeConfig = resolveRuntimeConfig();
  const baseUrl = runtimeConfig.previewGeneratorBaseUrl;
  if (!baseUrl) {
    return NextResponse.json({ error: "Preview generator is not configured" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
  }

  let cloudOrigin: string;
  try {
    cloudOrigin = new URL(baseUrl).origin;
  } catch {
    return NextResponse.json({ error: "Invalid preview generator base URL" }, { status: 400 });
  }

  if (targetUrl.origin !== cloudOrigin) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  const upstream = await fetch(targetUrl.toString(), {
    signal: req.signal ?? undefined
  });
  const headers = new Headers(upstream.headers);
  headers.set("access-control-allow-origin", "null");
  return new NextResponse(upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText
  });
}
