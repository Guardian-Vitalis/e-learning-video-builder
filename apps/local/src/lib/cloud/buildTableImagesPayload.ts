import type { DraftSection, JobInputTableImage } from "@evb/shared";
import { getTableImageBlob } from "../storage/tableImageStore";

type BuildPayloadArgs = {
  projectId: string;
  sections: DraftSection[];
  maxImages: number;
  maxTotalBytes: number;
  maxSingleBytes: number;
};

type BuildPayloadResult = {
  tableImages: JobInputTableImage[];
  totalBytes: number;
  skippedCount: number;
  skippedMissing: number;
  skippedLimit: number;
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function buildTableImagesPayload({
  projectId,
  sections,
  maxImages,
  maxTotalBytes,
  maxSingleBytes
}: BuildPayloadArgs): Promise<BuildPayloadResult> {
  const tableImages: JobInputTableImage[] = [];
  let totalBytes = 0;
  let skippedCount = 0;
  let skippedMissing = 0;
  let skippedLimit = 0;

  for (const section of sections) {
    const attachments = section.tableImages ?? [];
    for (const attachment of attachments) {
      if (tableImages.length >= maxImages) {
        skippedCount += 1;
        skippedLimit += 1;
        continue;
      }
      const blob = await getTableImageBlob(projectId, attachment.id);
      if (!blob) {
        skippedCount += 1;
        skippedMissing += 1;
        continue;
      }
      if (blob.size > maxSingleBytes || totalBytes + blob.size > maxTotalBytes) {
        skippedCount += 1;
        skippedLimit += 1;
        continue;
      }
      const buffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      tableImages.push({
        id: attachment.id,
        sectionId: attachment.sectionId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        anchorText: attachment.anchorText,
        base64
      });
      totalBytes += blob.size;
    }
  }

  return { tableImages, totalBytes, skippedCount, skippedMissing, skippedLimit };
}
