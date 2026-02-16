import JSZip from "jszip";
import { DraftSection, TableImageAttachment } from "@evb/shared";

type TableImagesResult = {
  attachments: TableImageAttachment[];
  blobs: Map<string, Blob>;
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `attachment_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getAttributeValue(element: Element, name: string) {
  return (
    element.getAttribute(name) ??
    element.getAttribute(`w:${name}`) ??
    element.getAttribute(`r:${name}`) ??
    ""
  );
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

function getCellText(cell: Element) {
  const textNodes = Array.from(cell.getElementsByTagName("w:t"));
  const combined = textNodes.map((node) => node.textContent ?? "").join(" ");
  return combined.replace(/\s+/g, " ").trim();
}

function getImageRelIds(cell: Element) {
  const ids = new Set<string>();
  for (const blip of Array.from(cell.getElementsByTagName("a:blip"))) {
    const relId = getAttributeValue(blip, "embed");
    if (relId) {
      ids.add(relId);
    }
  }
  for (const image of Array.from(cell.getElementsByTagName("v:imagedata"))) {
    const relId = getAttributeValue(image, "id");
    if (relId) {
      ids.add(relId);
    }
  }
  return Array.from(ids);
}

function buildRelsMap(relsXml: string) {
  const parser = new DOMParser();
  const relsDoc = parser.parseFromString(relsXml, "application/xml");
  const relationships = Array.from(relsDoc.getElementsByTagName("Relationship"));
  const map = new Map<string, string>();
  for (const rel of relationships) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) {
      map.set(id, target);
    }
  }
  return map;
}

function getMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export function extractTableImagesFromXml(
  documentXml: string,
  relsMap: Map<string, string>,
  sections: DraftSection[]
): TableImageAttachment[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(documentXml, "application/xml");
  const body = doc.getElementsByTagName("w:body")[0];
  const children = Array.from(body?.childNodes ?? []);

  let sectionIndex = -1;
  const defaultSectionId = sections[0]?.id ?? null;
  let currentSectionId = defaultSectionId;
  let tableIndex = 0;
  const attachments: TableImageAttachment[] = [];

  for (const node of children) {
    if (node.nodeType !== 1) {
      continue;
    }
    const element = node as Element;
    if (element.tagName === "w:p") {
      const style = element.getElementsByTagName("w:pStyle")[0];
      const styleValue = style ? getAttributeValue(style, "val") : "";
      const headingLevel = styleValue ? getHeadingLevel(styleValue) : null;
      if (headingLevel !== null) {
        sectionIndex += 1;
        currentSectionId = sections[sectionIndex]?.id ?? currentSectionId ?? defaultSectionId;
      }
      continue;
    }

    if (element.tagName !== "w:tbl") {
      continue;
    }

    const rows = Array.from(element.getElementsByTagName("w:tr"));
    const rowCells = rows.map((row) => Array.from(row.getElementsByTagName("w:tc")));
    const rowTexts = rowCells.map((cells) => cells.map((cell) => getCellText(cell)));
    const tableFallback =
      rowTexts.flat().find((text) => text) ?? "Table image";

    rowCells.forEach((cells, rowIndex) => {
      const rowFallback = rowTexts[rowIndex].find((text) => text) ?? tableFallback;
      cells.forEach((cell, cellIndex) => {
        const relIds = getImageRelIds(cell);
        if (relIds.length === 0) {
          return;
        }
        const cellText = rowTexts[rowIndex][cellIndex];
        const anchorText = cellText || rowFallback || "Table image";
        for (const relId of relIds) {
          const target = relsMap.get(relId);
          if (!target) {
            console.debug("missing rel for image", relId);
            continue;
          }
          if (!currentSectionId) {
            continue;
          }
          const fileName = target.split("/").pop() ?? target;
          attachments.push({
            id: createId(),
            sectionId: currentSectionId,
            tableIndex,
            rowIndex,
            cellIndex,
            anchorText,
            relId,
            fileName,
            mimeType: getMimeType(fileName)
          });
        }
      });
    });

    tableIndex += 1;
  }

  return attachments;
}

export async function extractTableImages(
  buffer: ArrayBuffer,
  sections: DraftSection[]
): Promise<TableImagesResult> {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Invalid docx: missing word/document.xml");
  }
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) {
    return { attachments: [], blobs: new Map() };
  }
  const [documentXml, relsXml] = await Promise.all([
    documentFile.async("string"),
    relsFile.async("string")
  ]);
  const relsMap = buildRelsMap(relsXml);
  const attachments = extractTableImagesFromXml(documentXml, relsMap, sections);
  const blobs = new Map<string, Blob>();
  for (const attachment of attachments) {
    const target = relsMap.get(attachment.relId);
    if (!target) {
      continue;
    }
    const path = target.startsWith("word/") ? target : `word/${target}`;
    const file = zip.file(path);
    if (!file) {
      console.debug("missing image file", path);
      continue;
    }
    const blob = await file.async("blob");
    blobs.set(attachment.id, blob);
  }
  return { attachments, blobs };
}
