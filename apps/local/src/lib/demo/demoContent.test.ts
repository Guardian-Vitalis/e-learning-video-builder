import { describe, expect, it } from "vitest";
import { buildDemoDraftManifest, buildDemoProjectName } from "./demoContent";

describe("demoContent", () => {
  it("builds a readable demo project name", () => {
    const name = buildDemoProjectName(new Date("2024-01-02T03:04:00.000Z"));
    expect(name).toContain("Demo Project");
  });

  it("builds a demo manifest with selected sections", () => {
    const manifest = buildDemoDraftManifest("Demo Course");
    expect(manifest.sections.length).toBeGreaterThanOrEqual(5);
    expect(manifest.sections.length).toBeLessThanOrEqual(8);
    expect(manifest.sections.every((section) => section.selected)).toBe(true);
    expect(manifest.sections.every((section) => section.script.length > 0)).toBe(true);
  });
});
