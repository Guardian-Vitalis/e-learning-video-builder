import { Router } from "express";
import { randomUUID } from "crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDocxSections } from "../lib/docx/docxParser";

const MAX_DOCX_BYTES = 120 * 1024 * 1024;
const PREVIEW_LINE_LIMIT = 80;
const PREVIEW_CHAR_LIMIT = 12000;

type DocxImportRequest = {
  filename?: string;
  dataBase64?: string;
};

const router = Router();
const storedDocxByProject = new Map<
  string,
  { title?: string; sections: Map<string, { level: 1 | 2 | 3; heading: string; text: string }> }
>();

function buildPreviewText(text: string) {
  if (!text) {
    return "";
  }
  let lines = 1;
  let endIndex = 0;
  for (let i = 0; i < text.length && i < PREVIEW_CHAR_LIMIT; i += 1) {
    if (text[i] === "\n") {
      lines += 1;
      if (lines > PREVIEW_LINE_LIMIT) {
        endIndex = i;
        break;
      }
    }
    endIndex = i + 1;
  }
  return text.slice(0, endIndex);
}

function parseContentDisposition(headersText: string) {
  const nameMatch = headersText.match(/name="([^"]+)"/i);
  const filenameMatch = headersText.match(/filename="([^"]*)"/i);
  return {
    name: nameMatch?.[1],
    filename: filenameMatch?.[1]
  };
}

function stripTrailingCrlf(buffer: Buffer) {
  if (
    buffer.length >= 2 &&
    buffer[buffer.length - 2] === 13 &&
    buffer[buffer.length - 1] === 10
  ) {
    return buffer.slice(0, -2);
  }
  return buffer;
}

function toBuffer(input: unknown): Buffer {
  if (Buffer.isBuffer(input)) {
    return input;
  }
  if (typeof input === "string") {
    return Buffer.from(input, "utf8");
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(input));
  }
  if (input && typeof (input as { byteLength?: number }).byteLength === "number") {
    return Buffer.from(input as ArrayBufferView);
  }
  return Buffer.from(String(input ?? ""), "utf8");
}

function bufferStartsWith(value: Buffer, prefix: Buffer) {
  return value.length >= prefix.length && value.subarray(0, prefix.length).equals(prefix);
}

async function parseMultipartToFile(req: any, boundary: string, tmpPath: string) {
  const fields: Record<string, string> = {};
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const boundaryDelimiter = Buffer.from(`\r\n--${boundary}`);
  const keepBytes = boundaryDelimiter.length + 4;
  let buffer = Buffer.alloc(0);
  let state: "preamble" | "headers" | "file" | "field" | "done" = "preamble";
  let currentName = "";
  let currentFilename = "";
  let fieldChunks: Buffer[] = [];
  let fileStream: fs.WriteStream | null = null;
  let fileInfo: { filename: string; path: string; bytes: number } | null = null;
  let fileBytes = 0;
  let receivedFileBytes = 0;
  let tooLarge = false;

  const ensureFileStream = () => {
    if (!fileStream) {
      fileStream = fs.createWriteStream(tmpPath);
    }
  };

  const writeFileChunk = async (data: Buffer) => {
    if (!fileStream || data.length === 0) {
      return;
    }
    receivedFileBytes += data.length;
    if (!tooLarge && receivedFileBytes > MAX_DOCX_BYTES) {
      tooLarge = true;
    }
    if (tooLarge) {
      return;
    }
    fileBytes += data.length;
    if (!fileStream.write(data)) {
      await new Promise<void>((resolve, reject) => {
        fileStream?.once("drain", resolve);
        fileStream?.once("error", reject);
      });
    }
  };

  const finalizeField = (data: Buffer) => {
    if (!currentName) {
      return;
    }
    const value = data.toString("utf8");
    fields[currentName] = value;
  };

  const finalizeFile = async (data: Buffer) => {
    if (!fileStream) {
      return;
    }
    await writeFileChunk(data);
    await new Promise<void>((resolve, reject) => {
      fileStream?.end(() => resolve());
      fileStream?.once("error", reject);
    });
    fileInfo = { filename: currentFilename, path: tmpPath, bytes: fileBytes };
  };

  for await (const chunk of req) {
    buffer = Buffer.concat([buffer, toBuffer(chunk)]);
    buffer = toBuffer(buffer);

    while (state !== "done") {
      if (state === "preamble") {
        const idx = buffer.indexOf(boundaryMarker);
        if (idx === -1) {
          if (buffer.length > boundaryMarker.length) {
            buffer = buffer.slice(buffer.length - boundaryMarker.length);
          }
          break;
        }
        buffer = buffer.slice(idx + boundaryMarker.length);
        if (bufferStartsWith(buffer, Buffer.from("--"))) {
          state = "done";
          buffer = Buffer.alloc(0);
          break;
        }
        if (bufferStartsWith(buffer, Buffer.from("\r\n"))) {
          buffer = buffer.slice(2);
        }
        state = "headers";
        continue;
      }

      if (state === "headers") {
        const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd === -1) {
          break;
        }
        const headersText = buffer.slice(0, headerEnd).toString("latin1");
        buffer = buffer.slice(headerEnd + 4);
        const disposition = parseContentDisposition(headersText);
        currentName = disposition.name ?? "";
        currentFilename = disposition.filename ?? "";
        fieldChunks = [];
        if (currentFilename) {
          ensureFileStream();
          state = "file";
        } else {
          state = "field";
        }
        continue;
      }

      if (state === "file" || state === "field") {
        const boundaryIndex = buffer.indexOf(boundaryDelimiter);
        if (boundaryIndex === -1) {
          if (buffer.length <= keepBytes) {
            break;
          }
          const data = buffer.slice(0, buffer.length - keepBytes);
          buffer = buffer.slice(buffer.length - keepBytes);
          if (state === "file") {
            await writeFileChunk(data);
          } else {
            fieldChunks.push(data);
          }
          continue;
        }

        const data = stripTrailingCrlf(buffer.slice(0, boundaryIndex));
        buffer = buffer.slice(boundaryIndex + boundaryDelimiter.length);

        if (state === "file") {
          await finalizeFile(data);
        } else {
          fieldChunks.push(data);
          finalizeField(Buffer.concat(fieldChunks));
        }

        if (bufferStartsWith(buffer, Buffer.from("--"))) {
          state = "done";
          buffer = Buffer.alloc(0);
          break;
        }
        if (bufferStartsWith(buffer, Buffer.from("\r\n"))) {
          buffer = buffer.slice(2);
        }
        state = "headers";
        continue;
      }
    }
  }

  if (state === "file") {
    await finalizeFile(stripTrailingCrlf(buffer));
  } else if (state === "field" && buffer.length > 0) {
    fieldChunks.push(stripTrailingCrlf(buffer));
    finalizeField(Buffer.concat(fieldChunks));
  }

  return {
    fields,
    file: fileInfo,
    tooLarge,
    receivedBytes: receivedFileBytes
  };
}

function getRequestId(req: any) {
  const header = req.headers?.["x-request-id"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return randomUUID();
}

function sendError(
  res: any,
  status: number,
  code: string,
  message: string,
  requestId: string,
  extra: Record<string, unknown> = {}
) {
  return res.status(status).json({
    requestId,
    error: { code, message, ...extra }
  });
}

router.post("/docx", async (req, res) => {
  const requestId = getRequestId(req);
  const contentType = req.headers["content-type"] ?? "";
  let filename = "";
  let buffer: Buffer | null = null;
  let projectId = "default";
  let tmpPath = "";

  if (contentType.startsWith("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return sendError(
        res,
        400,
        "INVALID_MULTIPART",
        "Missing multipart boundary.",
        requestId
      );
    }
    try {
      const tmpDir = path.join(os.tmpdir(), "evb");
      fs.mkdirSync(tmpDir, { recursive: true });
      tmpPath = path.join(
        tmpDir,
        `import-${Date.now()}-${Math.random().toString(16).slice(2)}.docx`
      );
      const parsedForm = await parseMultipartToFile(req, boundaryMatch[1], tmpPath);
      projectId = parsedForm.fields.projectId || projectId;
      filename = parsedForm.file?.filename ?? parsedForm.fields.filename ?? "";
      if (parsedForm.tooLarge) {
        return sendError(
          res,
          413,
          "FILE_TOO_LARGE",
          "DOCX file is too large.",
          requestId,
          { maxBytes: MAX_DOCX_BYTES, receivedBytes: parsedForm.receivedBytes }
        );
      }
      if (parsedForm.file) {
        buffer = await fs.promises.readFile(parsedForm.file.path);
      }
    } catch (err) {
      console.error("[cloud] import-docx", requestId, err);
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "Invalid multipart payload.",
        requestId
      );
    } finally {
      if (tmpPath) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
    }
  } else {
    const body = req.body as DocxImportRequest;
    filename = body?.filename ?? "";
    const dataBase64 = body?.dataBase64 ?? "";
    if (!filename || !dataBase64) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        "Missing filename or base64 payload.",
        requestId
      );
    }
    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch {
      return sendError(
        res,
        400,
        "INVALID_BASE64",
        "Invalid base64 payload.",
        requestId
      );
    }
  }

  if (!filename || !buffer) {
    return sendError(
      res,
      400,
      "INVALID_REQUEST",
      "No DOCX file provided.",
      requestId,
      { expectedField: "file" }
    );
  }
  if (!filename.toLowerCase().endsWith(".docx")) {
    return sendError(
      res,
      400,
      "INVALID_FILE",
      "Only .docx files are supported.",
      requestId
    );
  }
  if (buffer.length === 0) {
    return sendError(
      res,
      400,
      "INVALID_BASE64",
      "DOCX payload is empty.",
      requestId
    );
  }
  if (buffer.length > MAX_DOCX_BYTES) {
    return sendError(
      res,
      413,
      "FILE_TOO_LARGE",
      "DOCX file is too large.",
      requestId
    );
  }

  try {
    const parsed = await parseDocxSections(buffer);
    const projectKey = projectId || "default";
    const sectionsStore = new Map<
      string,
      { level: 1 | 2 | 3; heading: string; text: string }
    >();
    let totalScriptChars = 0;
    parsed.sections.forEach((section) => {
      sectionsStore.set(section.sectionId, {
        level: section.level,
        heading: section.heading,
        text: section.text
      });
      totalScriptChars += section.text.length;
    });
    storedDocxByProject.set(projectKey, { title: parsed.title, sections: sectionsStore });

    const summary = {
      title: parsed.title,
      sections: parsed.sections.map((section) => ({
        sectionId: section.sectionId,
        level: section.level,
        heading: section.heading,
        text: buildPreviewText(section.text)
      }))
    };
    console.log(
      `[cloud] docx import summary sections=${summary.sections.length} totalScriptChars=${totalScriptChars} responseMode=summary`
    );
    return res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "docx_missing_document_xml") {
      return sendError(
        res,
        400,
        "INVALID_DOCX",
        "DOCX is missing document.xml.",
        requestId
      );
    }
    console.error("[cloud] import-docx", requestId, err);
    return sendError(
      res,
      500,
      "DOCX_PARSE_FAILED",
      "Unable to parse DOCX file.",
      requestId
    );
  }
});

router.get("/projects/:projectId/sections/:sectionId/script", (req, res) => {
  const projectId = req.params.projectId;
  const sectionId = req.params.sectionId;
  const stored = storedDocxByProject.get(projectId);
  if (!stored) {
    return res.status(404).json({ error: "missing_project" });
  }
  const section = stored.sections.get(sectionId);
  if (!section) {
    return res.status(404).json({ error: "missing_section" });
  }
  return res.json({ sectionId, text: section.text });
});

export { router as importDocxRouter };
