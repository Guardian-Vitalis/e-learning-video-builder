import { describe, expect, it } from "vitest";
import { validateDocxSize } from "./docxValidation";

const MB = 1024 * 1024;

describe("validateDocxSize", () => {
  it("allows files under the warning threshold", () => {
    const result = validateDocxSize("doc.docx", 60 * MB);
    expect(result.status).toBe("ok");
  });

  it("warns for large files", () => {
    const result = validateDocxSize("doc.docx", 150 * MB);
    expect(result.status).toBe("warn");
    expect(result.title).toBe("Large file");
  });

  it("blocks files over the max size", () => {
    const result = validateDocxSize("doc.docx", 320 * MB);
    expect(result.status).toBe("error");
    expect(result.title).toBe("File too large");
  });
});
