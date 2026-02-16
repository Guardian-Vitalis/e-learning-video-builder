import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTableImagesPayload } from "./buildTableImagesPayload";
import type { DraftSection, TableImageAttachment } from "@evb/shared";

const getTableImageBlob = vi.fn();

vi.mock("../storage/tableImageStore", () => ({
  getTableImageBlob: (projectId: string, attachmentId: string) =>
    getTableImageBlob(projectId, attachmentId)
}));

function makeAttachment(id: string): TableImageAttachment {
  return {
    id,
    sectionId: "section-1",
    tableIndex: 0,
    rowIndex: 0,
    cellIndex: 0,
    anchorText: "Cell text",
    relId: "rId1",
    fileName: `${id}.png`,
    mimeType: "image/png"
  };
}

function makeBlob(bytes: Uint8Array, type = "image/png"): Blob {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  return {
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => arrayBuffer
  } as Blob;
}

function makeSection(attachments: TableImageAttachment[]): DraftSection {
  return {
    id: "section-1",
    title: "Section 1",
    level: 1,
    selected: true,
    script: "Script",
    mediaRefs: [],
    tableImages: attachments
  };
}

describe("buildTableImagesPayload", () => {
  beforeEach(() => {
    getTableImageBlob.mockReset();
  });

  it("returns empty payload when no table images exist", async () => {
    const result = await buildTableImagesPayload({
      projectId: "p1",
      sections: [makeSection([])],
      maxImages: 5,
      maxTotalBytes: 1024,
      maxSingleBytes: 1024
    });

    expect(result.tableImages).toEqual([]);
    expect(result.totalBytes).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.skippedMissing).toBe(0);
    expect(result.skippedLimit).toBe(0);
  });

  it("enforces max image limit", async () => {
    const attachments = [makeAttachment("img-1"), makeAttachment("img-2")];
    getTableImageBlob.mockResolvedValue(makeBlob(new Uint8Array([105, 109, 103])));

    const result = await buildTableImagesPayload({
      projectId: "p1",
      sections: [makeSection(attachments)],
      maxImages: 1,
      maxTotalBytes: 1024,
      maxSingleBytes: 1024
    });

    expect(result.tableImages).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
    expect(result.skippedLimit).toBe(1);
  });

  it("base64 encodes table image blobs", async () => {
    const attachments = [makeAttachment("img-1")];
    getTableImageBlob.mockResolvedValue(makeBlob(new Uint8Array([104, 105])));

    const result = await buildTableImagesPayload({
      projectId: "p1",
      sections: [makeSection(attachments)],
      maxImages: 5,
      maxTotalBytes: 1024,
      maxSingleBytes: 1024
    });

    expect(result.tableImages[0]?.base64).toBe("aGk=");
  });

  it("counts missing blobs separately", async () => {
    const attachments = [makeAttachment("img-1")];
    getTableImageBlob.mockResolvedValue(null);

    const result = await buildTableImagesPayload({
      projectId: "p1",
      sections: [makeSection(attachments)],
      maxImages: 5,
      maxTotalBytes: 1024,
      maxSingleBytes: 1024
    });

    expect(result.tableImages).toHaveLength(0);
    expect(result.skippedMissing).toBe(1);
  });
});
