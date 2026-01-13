import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseDocxSections } from "./docxParser";

async function buildDocxBuffer(documentXml: string) {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("docxParser", () => {
  it("extracts title and heading sections with deterministic ids", async () => {
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
    <w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2" /></w:pPr>
      <w:r><w:t>Sub A</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Sub paragraph.</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading3" /></w:pPr>
      <w:r><w:t>Detail 1</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Detail text.</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1" /></w:pPr>
      <w:r><w:t>Section Two</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>Another paragraph.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const buffer = await buildDocxBuffer(xml);
    const result = await parseDocxSections(buffer);
    const repeat = await parseDocxSections(buffer);

    expect(result.title).toBe("Training Manual");
    expect(result.sections).toHaveLength(4);
    expect(result.sections.map((section) => section.sectionId)).toEqual(
      repeat.sections.map((section) => section.sectionId)
    );

    expect(result.sections[0]).toMatchObject({
      sectionId: "s01-section-one",
      level: 1,
      heading: "Section One",
      text: "First paragraph.\nSecond paragraph."
    });
    expect(result.sections[1]).toMatchObject({
      sectionId: "s01-01-sub-a",
      level: 2,
      heading: "Sub A",
      text: "Sub paragraph."
    });
    expect(result.sections[2]).toMatchObject({
      sectionId: "s01-01-01-detail-1",
      level: 3,
      heading: "Detail 1",
      text: "Detail text."
    });
    expect(result.sections[3]).toMatchObject({
      sectionId: "s02-section-two",
      level: 1,
      heading: "Section Two",
      text: "Another paragraph."
    });
  });
});
