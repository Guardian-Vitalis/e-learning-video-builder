import { createServer } from "node:http";
import { SAMPLE_MP4_BASE64 } from "../../../lib/localAvatar/__fixtures__/sampleMp4Base64";

export type LocalAvatarEmulator = {
  url: string;
  close: () => Promise<void>;
};

export async function startLocalAvatarEmulator(options?: {
  status?: number;
  response?: Record<string, unknown>;
  delayMs?: number;
  statusSequence?: Array<"queued" | "running" | "succeeded" | "failed">;
}): Promise<LocalAvatarEmulator> {
  const statusSequence = options?.statusSequence ?? ["succeeded"];
  let pollCount = 0;

  const server = createServer((req, res) => {
    const url = req.url ?? "";
    const status = options?.status ?? 200;
    const delayMs = options?.delayMs ?? 0;
    const respond = (code: number, payload: unknown) => {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    if (req.method === "GET" && url === "/health") {
      return setTimeout(() => {
        respond(status, options?.response ?? { ok: true, name: "musetalk" });
      }, delayMs);
    }

    if (req.method === "GET" && url === "/health/details") {
      return setTimeout(() => {
        respond(status, options?.response ?? {
          ok: true,
          name: "musetalk",
          version: "test",
          ffmpeg: { found: true, version: "test", path: "ffmpeg" },
          weights: { required: [], missing: [] }
        });
      }, delayMs);
    }

    if (req.method === "POST" && url === "/v1/jobs") {
      return setTimeout(() => {
        respond(status, options?.response ?? { accepted: true });
      }, delayMs);
    }

    if (req.method === "GET" && url.includes("/status")) {
      const nextStatus = statusSequence[Math.min(pollCount, statusSequence.length - 1)];
      pollCount += 1;
      return setTimeout(() => {
        if (nextStatus === "failed") {
          respond(status, options?.response ?? { status: "failed", error: "engine failed" });
        } else {
          respond(status, options?.response ?? { status: nextStatus });
        }
      }, delayMs);
    }

    if (req.method === "GET" && url.includes("/artifacts")) {
      return setTimeout(() => {
        respond(status, options?.response ?? { mp4Base64: SAMPLE_MP4_BASE64, durationMs: 1200 });
      }, delayMs);
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start local avatar emulator");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
