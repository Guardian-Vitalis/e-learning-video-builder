import { Router } from "express";
import { parseDocxSections } from "../lib/docx/docxParser";

const MAX_DOCX_BYTES = 8 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
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

function parseMultipartForm(body: Buffer, boundary: string) {
  const delimiter = `--${boundary}`;
  const payload = body.toString("latin1");
  const parts = payload.split(delimiter).slice(1, -1);
  const fields: Record<string, string> = {};
  let file: { filename: string; buffer: Buffer } | null = null;

  for (const part of parts) {
    let chunk = part;
    if (chunk.startsWith("\r\n")) {
      chunk = chunk.slice(2);
    }
    if (chunk.endsWith("\r\n")) {
      chunk = chunk.slice(0, -2);
    }
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      continue;
    }
    const headersText = chunk.slice(0, headerEnd);
    let content = chunk.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) {
      content = content.slice(0, -2);
    }
    const disposition = parseContentDisposition(headersText);
    if (!disposition.name) {
      continue;
    }
    if (disposition.filename) {
      file = {
        filename: disposition.filename,
        buffer: Buffer.from(content, "latin1")
      };
      continue;
    }
    fields[disposition.name] = content;
  }

  return { fields, file };
}

async function readRequestBuffer(req: any, limit: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<Buffer>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

router.post("/docx", async (req, res) => {
  const contentType = req.headers["content-type"] ?? "";
  let filename = "";
  let buffer: Buffer | null = null;
  let projectId = "default";

  if (contentType.startsWith("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return res.status(400).json({ error: "invalid_multipart" });
    }
    try {
      const bodyBuffer = await readRequestBuffer(
        req,
        MAX_DOCX_BYTES + MULTIPART_OVERHEAD_BYTES
      );
      const parsedForm = parseMultipartForm(bodyBuffer, boundaryMatch[1]);
      projectId = parsedForm.fields.projectId || projectId;
      filename = parsedForm.file?.filename ?? parsedForm.fields.filename ?? "";
      buffer = parsedForm.file?.buffer ?? null;
    } catch (err) {
      if (err instanceof Error && err.message === "payload_too_large") {
        return res.status(413).json({ error: "file_too_large" });
      }
      return res.status(400).json({ error: "invalid_request" });
    }
  } else {
    const body = req.body as DocxImportRequest;
    filename = body?.filename ?? "";
    const dataBase64 = body?.dataBase64 ?? "";
    if (!filename || !dataBase64) {
      return res.status(400).json({ error: "invalid_request" });
    }
    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch {
      return res.status(400).json({ error: "invalid_base64" });
    }
  }

  if (!filename || !buffer) {
    return res.status(400).json({ error: "invalid_request" });
  }
  if (!filename.toLowerCase().endsWith(".docx")) {
    return res.status(400).json({ error: "invalid_file" });
  }
  if (buffer.length === 0) {
    return res.status(400).json({ error: "invalid_base64" });
  }
  if (buffer.length > MAX_DOCX_BYTES) {
    return res.status(413).json({ error: "file_too_large" });
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
      return res.status(400).json({ error: "invalid_docx" });
    }
    return res.status(500).json({ error: "docx_parse_failed" });
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
