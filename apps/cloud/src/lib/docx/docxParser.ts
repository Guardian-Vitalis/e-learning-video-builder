import JSZip from "jszip";

type DocxSection = {
  sectionId: string;
  level: 1 | 2 | 3;
  heading: string;
  text: string;
};

type DocxImportResult = {
  title?: string;
  sections: DocxSection[];
};

const TEXT_TAG_REGEX = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
const PARAGRAPH_REGEX = /<w:p\b[\s\S]*?<\/w:p>/g;
const STYLE_REGEX = /<w:pStyle\b[^>]*?(?:w:)?val="([^"]+)"/i;

function decodeXml(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function getHeadingLevel(styleValue: string) {
  if (!styleValue) {
    return null;
  }
  const match = styleValue.match(/^Heading([1-3])$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]) as 1 | 2 | 3;
}

function getParagraphText(paragraphXml: string) {
  const parts: string[] = [];
  for (const match of paragraphXml.matchAll(TEXT_TAG_REGEX)) {
    parts.push(decodeXml(match[1]));
  }
  return normalizeText(parts.join(" "));
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
  return slug || "section";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function extractSectionsFromDocxXml(documentXml: string): DocxImportResult {
  const sections: DocxSection[] = [];
  const fallbackLines: string[] = [];
  let foundHeading = false;
  let docTitle: string | undefined;
  let currentSection: DocxSection | null = null;
  const counters = { h1: 0, h2: 0, h3: 0 };

  for (const paragraphMatch of documentXml.matchAll(PARAGRAPH_REGEX)) {
    const paragraphXml = paragraphMatch[0];
    const styleMatch = paragraphXml.match(STYLE_REGEX);
    const styleValue = styleMatch ? styleMatch[1] : "";
    const isTitle = /^title$/i.test(styleValue);
    const headingLevel = getHeadingLevel(styleValue);
    const text = getParagraphText(paragraphXml);

    if (isTitle) {
      if (!docTitle && text) {
        docTitle = text;
      }
      continue;
    }

    if (headingLevel !== null) {
      foundHeading = true;
      const heading = text || "Untitled section";
      if (headingLevel === 1) {
        counters.h1 += 1;
        counters.h2 = 0;
        counters.h3 = 0;
      } else if (headingLevel === 2) {
        if (counters.h1 === 0) {
          counters.h1 = 1;
        }
        counters.h2 += 1;
        counters.h3 = 0;
      } else {
        if (counters.h1 === 0) {
          counters.h1 = 1;
        }
        if (counters.h2 === 0) {
          counters.h2 = 1;
        }
        counters.h3 += 1;
      }
      const parts =
        headingLevel === 1
          ? [pad2(counters.h1)]
          : headingLevel === 2
            ? [pad2(counters.h1), pad2(counters.h2)]
            : [pad2(counters.h1), pad2(counters.h2), pad2(counters.h3)];
      const sectionId = `s${parts.join("-")}-${slugify(heading)}`;
      currentSection = {
        sectionId,
        level: headingLevel,
        heading,
        text: ""
      };
      sections.push(currentSection);
      continue;
    }

    if (!text) {
      continue;
    }

    if (currentSection) {
      currentSection.text = [currentSection.text, text].filter(Boolean).join("\n");
    } else {
      fallbackLines.push(text);
    }
  }

  if (!foundHeading) {
    const heading = docTitle ?? "Document";
    sections.push({
      sectionId: `s01-${slugify(heading)}`,
      level: 1,
      heading,
      text: fallbackLines.join("\n").trim()
    });
  }

  return {
    title: docTitle,
    sections: sections.map((section) => ({
      ...section,
      text: section.text.trim()
    }))
  };
}

export async function parseDocxSections(buffer: Buffer): Promise<DocxImportResult> {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("docx_missing_document_xml");
  }
  const documentXml = await documentFile.async("string");
  return extractSectionsFromDocxXml(documentXml);
}
