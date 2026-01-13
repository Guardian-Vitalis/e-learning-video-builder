import { describe, expect, it } from "vitest";
import type { CourseVideoProject, GenerationSettings } from "@evb/shared";
import {
  assertProjectApproved,
  buildGenerationJobRequest,
  buildRegenerateJobRequest,
  GenerationGateError
} from "./generationDispatch";

const baseSettings: GenerationSettings = {
  outputMode: "avatar_only",
  avatarPresetId: "stub_avatar_m1",
  voicePresetId: "stub_voice_en_us_1",
  stylePresetId: "stub_style_clean",
  sentencesPerClip: 2,
  variationsPerSection: 1,
  updatedAt: "2024-01-03T00:00:00.000Z"
};

describe("generation dispatch gating", () => {
  it("blocks dispatch when approval is draft", () => {
    const project: CourseVideoProject = {
      id: "p1",
      name: "Course",
      status: "draft",
      approvalStatus: "draft",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      generationSettings: baseSettings
    };

    try {
      buildGenerationJobRequest({
        project,
        effectiveSettings: baseSettings,
        effectiveCleanupMode: "off",
        stubAvatarStyle: "silhouette",
        stubBackgroundStyle: "neutral"
      });
      throw new Error("Expected gate to throw.");
    } catch (err) {
      expect(err).toBeInstanceOf(GenerationGateError);
      if (err instanceof GenerationGateError) {
        expect(err.code).toBe("APPROVAL_REQUIRED");
        expect(err.message).toBe("Project must be approved before generation.");
      }
    }
  });

  it("assertProjectApproved throws when not approved", () => {
    const project: CourseVideoProject = {
      id: "p2",
      name: "Course",
      status: "draft",
      approvalStatus: "draft",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z"
    };

    expect(() => assertProjectApproved(project)).toThrow(GenerationGateError);
  });

  it("assertProjectApproved passes when approved", () => {
    const project: CourseVideoProject = {
      id: "p3",
      name: "Course",
      status: "approved",
      approvalStatus: "approved",
      approvedAt: "2024-01-02T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z"
    };

    expect(() => assertProjectApproved(project)).not.toThrow();
  });

  it("buildRegenerateJobRequest includes targetSectionIds", () => {
    const project: CourseVideoProject = {
      id: "p4",
      name: "Course",
      status: "approved",
      approvalStatus: "approved",
      approvedAt: "2024-01-02T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1",
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [
          { id: "s1", title: "Intro", script: "hello" },
          { id: "s2", title: "Next", script: "world" }
        ]
      },
      generationSettings: baseSettings
    };

    const request = buildRegenerateJobRequest({
      project,
      effectiveSettings: baseSettings,
      effectiveCleanupMode: "off",
      stubAvatarStyle: "silhouette",
      stubBackgroundStyle: "neutral",
      targetSectionIds: ["s2"]
    });

    expect(request.targetSectionIds).toEqual(["s2"]);
  });

  it("buildRegenerateJobRequest enforces approval gating", () => {
    const project: CourseVideoProject = {
      id: "p5",
      name: "Course",
      status: "draft",
      approvalStatus: "draft",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1",
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      },
      generationSettings: baseSettings
    };

    expect(() =>
      buildRegenerateJobRequest({
        project,
        effectiveSettings: baseSettings,
        effectiveCleanupMode: "off",
        stubAvatarStyle: "silhouette",
        stubBackgroundStyle: "neutral",
        targetSectionIds: ["s1"]
      })
    ).toThrow(GenerationGateError);
  });
});
