import { DraftSection } from "@evb/shared";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `section_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getAttributeValue(element: Element, name: string) {
  return element.getAttribute(name) ?? element.getAttribute(`w:${name}`) ?? "";
}

function getHeadingLevel(styleValue: string) {
  const match = styleValue.match(/^Heading([1-9])$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function getParagraphText(paragraph: Element) {
  const textNodes = Array.from(paragraph.getElementsByTagName("w:t"));
  const combined = textNodes.map((node) => node.textContent ?? "").join(" ");
  return combined.replace(/\s+/g, " ").trim();
}

export function extractSectionsFromXml(documentXml: string): DraftSection[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagName("w:p"));

  const sections: DraftSection[] = [];
  let currentSection: DraftSection | null = null;
  let foundHeading = false;
  const fallbackLines: string[] = [];

  for (const paragraph of paragraphs) {
    const paragraphText = getParagraphText(paragraph);
    const style = paragraph.getElementsByTagName("w:pStyle")[0];
    const styleValue = style ? getAttributeValue(style, "val") : "";
    const headingLevel = styleValue ? getHeadingLevel(styleValue) : null;

    if (headingLevel !== null) {
      foundHeading = true;
      const title = paragraphText || "Untitled section";
      currentSection = {
        id: createId(),
        title,
        level: headingLevel,
        selected: true,
        script: "",
        mediaRefs: []
      };
      sections.push(currentSection);
      continue;
    }

    if (!paragraphText) {
      continue;
    }

    if (currentSection) {
      currentSection.script = [currentSection.script, paragraphText]
        .filter(Boolean)
        .join("\n")
        .trim();
    } else {
      fallbackLines.push(paragraphText);
    }
  }

  if (!foundHeading) {
    const script = fallbackLines.join("\n").trim();
    return [
      {
        id: createId(),
        title: "Document",
        level: 0,
        selected: true,
        script,
        mediaRefs: []
      }
    ];
  }

  return sections.map((section) => ({
    ...section,
    script: section.script.trim()
  }));
}
