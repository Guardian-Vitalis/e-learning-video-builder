import { Router } from "express";
import { parseDocxSections } from "../lib/docx/docxParser";

const MAX_DOCX_BYTES = 8 * 1024 * 1024;

type DocxImportRequest = {
  filename?: string;
  dataBase64?: string;
};

const router = Router();

router.post("/docx", async (req, res) => {
  const body = req.body as DocxImportRequest;
  const filename = body?.filename ?? "";
  const dataBase64 = body?.dataBase64 ?? "";

  if (!filename || !dataBase64) {
    return res.status(400).json({ error: "invalid_request" });
  }
  if (!filename.toLowerCase().endsWith(".docx")) {
    return res.status(400).json({ error: "invalid_file" });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataBase64, "base64");
  } catch {
    return res.status(400).json({ error: "invalid_base64" });
  }
  if (buffer.length === 0) {
    return res.status(400).json({ error: "invalid_base64" });
  }

  if (buffer.length > MAX_DOCX_BYTES) {
    return res.status(413).json({ error: "file_too_large" });
  }

  try {
    const parsed = await parseDocxSections(buffer);
    return res.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "docx_missing_document_xml") {
      return res.status(400).json({ error: "invalid_docx" });
    }
    return res.status(500).json({ error: "docx_parse_failed" });
  }
});

export { router as importDocxRouter };
