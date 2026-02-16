import { describe, expect, it } from "vitest";
import { extractTableImagesFromXml } from "./extractTableImages";
import type { DraftSection } from "@evb/shared";

const sections: DraftSection[] = [
  {
    id: "s1",
    title: "Section 1",
    level: 1,
    selected: true,
    script: "",
    mediaRefs: []
  }
];

const relsMap = new Map<string, string>([["rId1", "media/image1.png"]]);

describe("extractTableImagesFromXml", () => {
  it("associates image with cell text", () => {
    const xml = `
      <w:document xmlns:w="w" xmlns:a="a" xmlns:r="r">
        <w:body>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading1" /></w:pPr>
            <w:r><w:t>Section 1</w:t></w:r>
          </w:p>
          <w:tbl>
            <w:tr>
              <w:tc>
                <w:p><w:r><w:t>Cell text</w:t></w:r></w:p>
                <w:p>
                  <w:r>
                    <w:drawing>
                      <a:blip r:embed="rId1" />
                    </w:drawing>
                  </w:r>
                </w:p>
              </w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>
    `;

    const attachments = extractTableImagesFromXml(xml, relsMap, sections);
    expect(attachments.length).toBe(1);
    expect(attachments[0].anchorText).toBe("Cell text");
    expect(attachments[0].sectionId).toBe("s1");
  });

  it("falls back to row text when cell text missing", () => {
    const xml = `
      <w:document xmlns:w="w" xmlns:a="a" xmlns:r="r">
        <w:body>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading1" /></w:pPr>
            <w:r><w:t>Section 1</w:t></w:r>
          </w:p>
          <w:tbl>
            <w:tr>
              <w:tc>
                <w:p>
                  <w:r>
                    <w:drawing>
                      <a:blip r:embed="rId1" />
                    </w:drawing>
                  </w:r>
                </w:p>
              </w:tc>
              <w:tc>
                <w:p><w:r><w:t>Row fallback</w:t></w:r></w:p>
              </w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>
    `;

    const attachments = extractTableImagesFromXml(xml, relsMap, sections);
    expect(attachments.length).toBe(1);
    expect(attachments[0].anchorText).toBe("Row fallback");
  });
});
