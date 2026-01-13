import { Router } from "express";
import type { Request, Response } from "express";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { parseArtifactToken } from "../lib/artifactTokens";

type ArtifactsRouterOptions = {
  artifactsDir: string;
};

function getContentType(ext: string) {
  switch (ext) {
    case ".mp4":
      return { type: "video/mp4", disposition: "inline" };
    case ".vtt":
      return { type: "text/vtt; charset=utf-8", disposition: "inline" };
    case ".srt":
      return { type: "application/x-subrip; charset=utf-8", disposition: "attachment" };
    case ".json":
      return { type: "application/json; charset=utf-8", disposition: "inline" };
    default:
      return { type: "application/octet-stream", disposition: "attachment" };
  }
}

function errorJson(message: string, details?: string) {
  return { error: { message, details } };
}

type RangeRequest = {
  start: number;
  end: number;
  size: number;
  chunkSize: number;
};

function parseRangeHeader(rangeHeader: string, size: number): RangeRequest | null {
  if (!rangeHeader.startsWith("bytes=") || rangeHeader.includes(",")) {
    return null;
  }
  const value = rangeHeader.replace("bytes=", "").trim();
  const [startRaw, endRaw] = value.split("-");
  const start = startRaw ? Number(startRaw) : NaN;
  const end = endRaw ? Number(endRaw) : NaN;

  if (!Number.isNaN(start) && startRaw && start < 0) {
    return null;
  }
  if (!Number.isNaN(end) && endRaw && end < 0) {
    return null;
  }

  let rangeStart: number;
  let rangeEnd: number;

  if (startRaw && endRaw) {
    rangeStart = start;
    rangeEnd = end;
  } else if (startRaw && !endRaw) {
    rangeStart = start;
    rangeEnd = size - 1;
  } else if (!startRaw && endRaw) {
    const suffixLength = end;
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    rangeStart = Math.max(size - suffixLength, 0);
    rangeEnd = size - 1;
  } else {
    return null;
  }

  if (
    Number.isNaN(rangeStart) ||
    Number.isNaN(rangeEnd) ||
    rangeStart > rangeEnd ||
    rangeStart >= size
  ) {
    return null;
  }

  if (rangeEnd >= size) {
    rangeEnd = size - 1;
  }

  const chunkSize = rangeEnd - rangeStart + 1;
  return { start: rangeStart, end: rangeEnd, size, chunkSize };
}

export function createArtifactsRouter({ artifactsDir }: ArtifactsRouterOptions) {
  const router = Router();
  const root = path.resolve(artifactsDir);

  const handleArtifact = async (req: Request, res: Response) => {
    const token = req.params.token;
    const relPath = req.params[0] ?? "";
    if (!token || !relPath) {
      return res.status(400).json(errorJson("Missing artifact path."));
    }
    if (relPath.split(/[\\/]/).includes("..")) {
      return res.status(403).json(errorJson("Invalid artifact path."));
    }

    const validation = parseArtifactToken(token);
    if (!validation.ok) {
      if (validation.expired) {
        return res.status(410).json(errorJson("Token expired."));
      }
      return res.status(401).json(errorJson("Invalid token."));
    }
    const tokenPath = validation.payload?.path ?? "";
    if (!tokenPath || tokenPath !== relPath) {
      return res.status(403).json(errorJson("Token not valid for requested artifact."));
    }

    const resolved = path.resolve(root, tokenPath);
    if (!resolved.startsWith(root + path.sep)) {
      return res.status(403).json(errorJson("Invalid artifact path."));
    }

    try {
      await fs.access(resolved);
    } catch {
      return res.status(404).json(errorJson("Artifact not found."));
    }

    const ext = path.extname(resolved);
    const { type, disposition } = getContentType(ext);
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `${disposition}; filename="${path.basename(resolved)}"`);
    res.setHeader("Cache-Control", "no-store");
    if (ext === ".mp4") {
      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        return res.status(404).json(errorJson("Artifact not found."));
      }
      const size = stat.size;
      res.setHeader("Accept-Ranges", "bytes");
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const range = parseRangeHeader(rangeHeader, size);
        if (!range) {
          res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
          if (process.env.EVB_LOG_RANGE === "1") {
            console.log(
              `[EVB] mp4 range req method=${req.method} range="${rangeHeader}" -> 416 total=${size}`
            );
          }
          return;
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader("Content-Length", range.chunkSize.toString());
        if (process.env.EVB_LOG_RANGE === "1") {
          console.log(
            `[EVB] mp4 range req method=${req.method} range="${rangeHeader}" -> 206 start=${range.start} end=${range.end} total=${size}`
          );
        }
        if (req.method === "HEAD") {
          return res.end();
        }
        const stream = createReadStream(resolved, {
          start: range.start,
          end: range.end
        });
        stream.on("error", () => {
          res.status(500).json(errorJson("Failed to read artifact."));
        });
        return stream.pipe(res);
      }
      res.setHeader("Content-Length", size.toString());
      if (process.env.EVB_LOG_RANGE === "1") {
        console.log(
          `[EVB] mp4 range req method=${req.method} range="none" -> 200 total=${size}`
        );
      }
      if (req.method === "HEAD") {
        return res.end();
      }
      const stream = createReadStream(resolved);
      stream.on("error", () => {
        res.status(500).json(errorJson("Failed to read artifact."));
      });
      return stream.pipe(res);
    }

    const stream = createReadStream(resolved);
    stream.on("error", () => {
      res.status(500).json(errorJson("Failed to read artifact."));
    });
    return stream.pipe(res);
  };

  router.get("/:token/*", handleArtifact);
  router.head("/:token/*", handleArtifact);

  return router;
}
