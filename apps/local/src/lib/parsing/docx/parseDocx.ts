import JSZip from "jszip";
import { extractSectionsFromXml } from "./extractSectionsFromXml";

export async function parseDocx(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Invalid docx: missing word/document.xml");
  }
  const xml = await documentFile.async("string");
  return extractSectionsFromXml(xml);
}
