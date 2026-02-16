import { NextRequest, NextResponse } from "next/server";
import { resolveRuntimeConfig } from "../../../lib/runtime/runtimeEnv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const config = resolveRuntimeConfig();
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const payload: Record<string, unknown> = {
    previewGeneratorBaseUrl: config.previewGeneratorBaseUrl,
    localAvatarEngineUrl: config.localAvatarEngineUrl,
    source: config.source
  };
  if (debug) {
    payload.debug = {
      cwd: process.cwd(),
      candidatePathsChecked: config.candidatePaths,
      chosenPath: config.chosenPath,
      foundKeys: config.foundKeys,
      parseNotes: config.parseNotes
    };
  }
  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "no-store, max-age=0, s-maxage=0, must-revalidate");
  return response;
}
