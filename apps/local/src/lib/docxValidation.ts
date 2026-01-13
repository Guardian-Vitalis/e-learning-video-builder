import { LARGE_DOCX_WARN_BYTES, MAX_DOCX_BYTES } from "./config";
import { formatBytes } from "./formatBytes";

type DocxSizeResult = {
  status: "ok" | "warn" | "error";
  title?: string;
  message?: string;
  details?: string;
};

export function validateDocxSize(fileName: string, sizeBytes: number): DocxSizeResult {
  if (sizeBytes > MAX_DOCX_BYTES) {
    return {
      status: "error",
      title: "File too large",
      message: `File is too large. Maximum size is ${formatBytes(MAX_DOCX_BYTES)}.`,
      details: `Selected file: ${fileName} (${formatBytes(
        sizeBytes
      )}). Tip: reduce embedded image size or split the manual into parts.`
    };
  }
  if (sizeBytes > LARGE_DOCX_WARN_BYTES) {
    return {
      status: "warn",
      title: "Large file",
      message:
        "Uploads and parsing may take longer and use more local storage.",
      details: `Selected file: ${fileName} (${formatBytes(
        sizeBytes
      )}). Tip: reduce embedded image size or split the manual into parts.`
    };
  }
  return { status: "ok" };
}
