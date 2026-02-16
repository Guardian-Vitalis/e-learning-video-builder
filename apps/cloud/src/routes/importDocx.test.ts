import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import JSZip from "jszip";
import { importDocxRouter } from "./importDocx";

async function buildDocxBase64(documentXml: string) {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.toString("base64");
}

describe("import docx route", () => {
  let serverUrl = "";
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: "12mb" }));
    app.use("/v1/import", importDocxRouter);
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      });
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it("parses a basic docx upload", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title" /></w:pPr>
      <w:r><w:t>Training Manual</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1" /></w:pPr>
      <w:r><w:t>Section One</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const dataBase64 = await buildDocxBase64(xml);
    const res = await fetch(`${serverUrl}/v1/import/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "manual.docx", dataBase64 })
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title?: string;
      sections: Array<{ sectionId: string; level: number; heading: string; text: string }>;
    };
    expect(body.title).toBe("Training Manual");
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].sectionId).toBe("s01-section-one");
  });

  it("rejects oversized payloads", async () => {
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 1).toString("base64");
    const res = await fetch(`${serverUrl}/v1/import/docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "big.docx", dataBase64: oversized })
    });
    expect([400, 413]).toContain(res.status);
  });
});
