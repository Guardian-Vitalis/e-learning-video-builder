import { describe, expect, it } from "vitest";
import { extractSectionsFromXml } from "./extractSectionsFromXml";

describe("extractSectionsFromXml", () => {
  it("extracts sections from heading styles", () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
            <w:r><w:t>Intro</w:t></w:r>
          </w:p>
          <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
            <w:r><w:t>Chapter</w:t></w:r>
          </w:p>
          <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;

    const sections = extractSectionsFromXml(xml);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Intro");
    expect(sections[0].script).toBe("First paragraph");
    expect(sections[1].title).toBe("Chapter");
    expect(sections[1].script).toBe("Second paragraph");
  });

  it("falls back to a single section when no headings exist", () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Line one</w:t></w:r></w:p>
          <w:p><w:r><w:t>Line two</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;

    const sections = extractSectionsFromXml(xml);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Document");
    expect(sections[0].level).toBe(0);
    expect(sections[0].script).toBe("Line one\nLine two");
  });

  it("uses an untitled label when heading text is empty", () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
            <w:r><w:t></w:t></w:r>
          </w:p>
          <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `;

    const sections = extractSectionsFromXml(xml);
    expect(sections[0].title).toBe("Untitled section");
    expect(sections[0].script).toBe("Body text");
  });
});
