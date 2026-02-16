import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createLocalAvatarClient,
  LocalAvatarClientConfig,
  LocalAvatarJobSubmit
} from "../../../lib/localAvatar/localAvatarClient";

const BACKOFF_STEPS_MS = [500, 750, 1100, 1600, 5000];

function nextBackoffMs(attempt: number) {
  if (attempt < BACKOFF_STEPS_MS.length) {
    return BACKOFF_STEPS_MS[attempt];
  }
  return BACKOFF_STEPS_MS[BACKOFF_STEPS_MS.length - 1];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPlaceholderPngBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AApMBgB2Zt9QAAAAASUVORK5CYII=";
}

async function readOptionalWavBase64(audioPathAbs: string) {
  if (!audioPathAbs.toLowerCase().endsWith(".wav")) {
    return undefined;
  }
  const buffer = await fs.readFile(audioPathAbs);
  return buffer.toString("base64");
}

export async function renderClipWithLocalMuseTalk(config: LocalAvatarClientConfig, input: {
  jobId: string;
  clipId: string;
  outputPathAbs: string;
  transcript: string;
  avatarPresetId?: string;
  avatarId?: string;
  bboxShift?: number;
  preparationHint?: "auto" | "prefer_cached" | "force_prepare";
  audioPathAbs: string;
  width: number;
  height: number;
  fps: number;
  timeoutMs: number;
}): Promise<{ durationMs?: number }> {
  const client = createLocalAvatarClient(config);
  const audioWavBase64 = await readOptionalWavBase64(input.audioPathAbs);
  const payload: LocalAvatarJobSubmit = {
    jobId: input.jobId,
    clipId: input.clipId,
    imagePngBase64: buildPlaceholderPngBase64(),
    audioWavBase64,
    scriptText: input.transcript,
    avatarId: input.avatarId,
    bboxShift: input.bboxShift,
    preparationHint: input.preparationHint,
    width: input.width,
    height: input.height,
    fps: input.fps
  };

  await client.submitClipJob(payload);

  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < input.timeoutMs) {
    const status = await client.pollClipStatus(input.jobId, input.clipId);
    if (status.status === "failed") {
      throw new Error(status.error || "Local avatar render failed");
    }
    if (status.status === "succeeded") {
      const artifacts = await client.fetchClipArtifacts(input.jobId, input.clipId);
      await fs.mkdir(path.dirname(input.outputPathAbs), { recursive: true });
      const buffer = Buffer.from(artifacts.mp4Base64, "base64");
      if (buffer.length <= 2048) {
        throw new Error("Local avatar MP4 payload too small");
      }
      await fs.writeFile(input.outputPathAbs, buffer);
      return { durationMs: artifacts.durationMs };
    }
    await sleep(nextBackoffMs(attempt));
    attempt += 1;
  }

  throw new Error("Local avatar render timed out");
}
