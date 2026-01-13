import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./docxStore", () => ({
  deleteDocx: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("./tableImageStore", () => ({
  deleteTableImagesForProject: vi.fn().mockResolvedValue(undefined)
}));
import {
  approveProject,
  buildApprovedManifest,
  canGenerate,
  clearCloudOutputs,
  clearGenerationJob,
  deleteProject,
  deleteProjectDocx,
  listProjects,
  parseStore,
  resetProjects,
  saveScriptDraft,
  serializeStore,
  updateDraftSection,
  getSelectedSectionCount,
  updateGenerationJobStatus,
  startGenerationJob,
  getProject,
  updateProject,
  STORAGE_KEY,
  isSettingsComplete,
  setGenerationSettings,
  validateGenerationSettings,
  resetApprovalToDraft,
  buildOutlineDisabledIds
} from "./projectsStore";
import { computeSentenceDiff } from "../script/scriptHashing";

describe("projectsStore serialization", () => {
  afterEach(() => {
    resetProjects();
  });

  it("round-trips a valid store", () => {
    const store = {
      version: 1 as const,
      projects: [
        {
          id: "p1",
          name: "Course Alpha",
          description: "Intro course",
          status: "draft" as const,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z"
        }
      ]
    };

    const raw = serializeStore(store);
    const parsed = parseStore(raw);
    expect(parsed).toEqual(store);
  });

  it("throws on missing required fields", () => {
    const raw = JSON.stringify({
      version: 1,
      projects: [
        {
          id: "p1",
          status: "draft",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z"
        }
      ]
    });

    expect(() => parseStore(raw)).toThrow();
  });

  it("updates a draft section immutably and toggles selected", () => {
    const manifest = {
      manifestVersion: "0.1" as const,
      courseTitle: "Course",
      doc: {
        fileName: "doc.docx",
        fileSize: 123,
        lastModified: 1,
        storedAt: "2024-01-01T00:00:00.000Z"
      },
      sections: [
        {
          id: "s1",
          title: "Intro",
          level: 1,
          selected: true,
          script: "hello",
          mediaRefs: []
        }
      ]
    };

    const updated = updateDraftSection(manifest, "s1", { script: "updated", selected: false });
    expect(updated).not.toBe(manifest);
    expect(updated.sections[0].script).toBe("updated");
    expect(updated.sections[0].selected).toBe(false);
  });

  it("preserves other sections when updating one", () => {
    const manifest = {
      manifestVersion: "0.1" as const,
      courseTitle: "Course",
      doc: {
        fileName: "doc.docx",
        fileSize: 123,
        lastModified: 1,
        storedAt: "2024-01-01T00:00:00.000Z"
      },
      sections: [
        {
          id: "s1",
          title: "Intro",
          level: 1,
          selected: true,
          script: "hello",
          mediaRefs: []
        },
        {
          id: "s2",
          title: "Next",
          level: 2,
          selected: true,
          script: "second",
          mediaRefs: []
        }
      ]
    };

    const updated = updateDraftSection(manifest, "s1", { script: "updated" });
    expect(updated.sections[1]).toEqual(manifest.sections[1]);
  });

  it("counts selected sections", () => {
    const manifest = {
      manifestVersion: "0.1" as const,
      courseTitle: "Course",
      doc: {
        fileName: "doc.docx",
        fileSize: 123,
        lastModified: 1,
        storedAt: "2024-01-01T00:00:00.000Z"
      },
      sections: [
        {
          id: "s1",
          title: "Intro",
          level: 1,
          selected: true,
          script: "hello",
          mediaRefs: []
        },
        {
          id: "s2",
          title: "Next",
          level: 2,
          selected: false,
          script: "second",
          mediaRefs: []
        }
      ]
    };

    const disabledIds = buildOutlineDisabledIds(manifest);
    expect(getSelectedSectionCount(manifest, disabledIds)).toBe(1);
    expect(getSelectedSectionCount(manifest, ["s1"])).toBe(1);
  });

  it("buildApprovedManifest includes only selected sections in order", async () => {
    const manifest = {
      manifestVersion: "0.1" as const,
      courseTitle: "Course",
      doc: {
        fileName: "doc.docx",
        fileSize: 123,
        lastModified: 1,
        storedAt: "2024-01-01T00:00:00.000Z"
      },
      sections: [
        {
          id: "s1",
          title: "Intro",
          level: 1,
          selected: true,
          script: "hello",
          mediaRefs: []
        },
        {
          id: "s2",
          title: "Skip",
          level: 2,
          selected: false,
          script: "skip",
          mediaRefs: []
        },
        {
          id: "s3",
          title: "End",
          level: 2,
          selected: true,
          script: "bye",
          mediaRefs: []
        }
      ]
    };

    const approved = await buildApprovedManifest("Course", manifest, {
      outputMode: "avatar_only",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 3,
      updatedAt: "2024-01-02T00:00:00.000Z"
    }, undefined, ["s2"]);
    expect(approved.sections.map((section) => section.id)).toEqual(["s1", "s3"]);
    expect(approved.settings?.variationsPerSection).toBe(3);
  });

  it("buildApprovedManifest includes prepared avatar block when provided", async () => {
    const manifest = {
      manifestVersion: "0.1" as const,
      courseTitle: "Course",
      doc: {
        fileName: "doc.docx",
        fileSize: 123,
        lastModified: 1,
        storedAt: "2024-01-01T00:00:00.000Z"
      },
      sections: [
        {
          id: "s1",
          title: "Intro",
          level: 1,
          selected: true,
          script: "hello",
          mediaRefs: []
        }
      ]
    };
    const settings = {
      outputMode: "avatar_only" as const,
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 1,
      variationsPerSection: 1,
      updatedAt: "2024-01-02T00:00:00.000Z"
    };
    const localAvatarState = {
      avatarId: "avatar-1",
      fps: 24,
      bboxShift: 3
    };
    const approved = await buildApprovedManifest(
      "Course",
      manifest,
      settings,
      undefined,
      undefined,
      undefined,
      localAvatarState
    );
    expect(approved.localAvatar).toEqual({
      kind: "prepared",
      avatarId: "avatar-1",
      fps: 24,
      bboxShift: 3
    });
  });

  it("approveProject sets status and approved manifest", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      approvalStatus: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };

    const store = { version: 1 as const, projects: [project] };
    localStorage.setItem(STORAGE_KEY, serializeStore(store));

    const approved = await approveProject("p1");
    expect(approved.status).toBe("approved");
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.approvedAt).toBeDefined();
    expect(approved.lastApprovedAt).toBeDefined();
    expect(approved.approvedManifest).toBeDefined();
  });

  it("approveProject omits prepared avatar when clip planner is disabled", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      approvalStatus: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      localAvatar: {
        avatarId: "avatar-1",
        fps: 24,
        bboxShift: 3,
        lastPreparedAt: "2024-01-03T00:00:00.000Z"
      },
      clipPlanner: { avatarMode: "none" as const },
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };
    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));

    const approved = await approveProject("p1");
    expect(approved.approvedManifest?.localAvatar).toBeUndefined();
  });

  it("approveProject stores per-section script hashes", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      approvalStatus: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      scriptEditsByNodeId: { s1: "Edited. Script." },
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "Base script.",
            mediaRefs: []
          }
        ]
      }
    };

    const store = { version: 1 as const, projects: [project] };
    localStorage.setItem(STORAGE_KEY, serializeStore(store));

    const approved = await approveProject("p1");
    expect(approved.approvedScriptHashByNodeId?.s1).toBeDefined();
    expect(approved.approvedSentenceHashesByNodeId?.s1?.length).toBe(2);
    expect(approved.approvedScriptHashAlgo).toBe("sha256");
  });

  it("resetApprovalToDraft clears approval metadata", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      approvalStatus: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedAt: "2024-01-02T00:00:00.000Z",
      lastApprovedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const reset = resetApprovalToDraft("p1");
    expect(reset.status).toBe("draft");
    expect(reset.approvalStatus).toBe("draft");
    expect(reset.approvedAt).toBeUndefined();
    expect(reset.approvedManifest).toBeUndefined();
  });

  it("invalidates approval when draftManifest changes", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const approved = await approveProject("p1");
    const updated = updateProject({
      id: "p1",
      draftManifest: {
        ...approved.draftManifest,
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "updated",
            mediaRefs: []
          }
        ]
      }
    });

    expect(updated.status).toBe("needs_approval");
    expect(updated.approvedManifest).toBeUndefined();
    expect(updated.lastApprovedAt).toBe(approved.lastApprovedAt);
  });

  it("keeps approved hashes when approval is reset", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      approvalStatus: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "Hello world.",
            mediaRefs: []
          }
        ]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const approved = await approveProject("p1");
    const saved = saveScriptDraft("p1", "s1", "Hello universe.");

    expect(saved.approvalStatus).toBe("draft");
    expect(saved.approvedScriptHashByNodeId?.s1).toBe(approved.approvedScriptHashByNodeId?.s1);
  });

  it("computeSentenceDiff reports changed sentences", async () => {
    const { buildScriptHashMetadata } = await import("../script/scriptHashing");
    const approvedMeta = await buildScriptHashMetadata("A. B.", "sha256");
    const diff = await computeSentenceDiff(approvedMeta.sentenceHashes, "A. C.");
    expect(diff.changedSentences).toBe(1);
  });

  it("persists local avatar advanced settings without changing outline IDs or manifest", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "A",
            title: "Alpha",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          },
          {
            id: "B",
            title: "Beta",
            level: 2,
            selected: true,
            script: "world",
            mediaRefs: []
          },
          {
            id: "C",
            title: "Gamma",
            level: 2,
            selected: true,
            script: "end",
            mediaRefs: []
          }
        ]
      }
    };

    const originalManifest = project.draftManifest;
    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    updateProject({
      id: "p1",
      localAvatarAdvanced: { avatarId: "demo", fps: 25, bboxShift: -7 }
    });

    const updated = getProject("p1");
    expect(updated?.localAvatarAdvanced).toEqual({
      avatarId: "demo",
      fps: 25,
      bboxShift: -7
    });
    expect(updated?.draftManifest?.sections.map((section) => section.id)).toEqual([
      "A",
      "B",
      "C"
    ]);
    expect(updated?.draftManifest).toEqual(originalManifest);
    expect(updated?.approvedManifest).toBeUndefined();
  });

  it("clears generation job when draftManifest changes", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "generating" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      generationJob: {
        jobId: "job-1",
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z"
      },
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const updated = updateProject({
      id: "p1",
      draftManifest: {
        ...project.draftManifest,
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "updated",
            mediaRefs: []
          }
        ]
      }
    });

    expect(updated.generationJob).toBeUndefined();
  });

  it("considers generation settings complete when valid", () => {
    const settings = {
      outputMode: "avatar_only" as const,
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1,
      updatedAt: "2024-01-01T00:00:00.000Z"
    };

    expect(isSettingsComplete(settings)).toBe(true);
  });

  it("isSettingsComplete returns false for invalid settings", () => {
    const settings = {
      outputMode: "avatar_only" as const,
      avatarPresetId: "",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1,
      updatedAt: "2024-01-01T00:00:00.000Z"
    };

    expect(isSettingsComplete(settings)).toBe(false);
    expect(isSettingsComplete(undefined)).toBe(false);
  });

  it("validateGenerationSettings returns field errors for invalid inputs", () => {
    const result = validateGenerationSettings({
      outputMode: "avatar_only",
      avatarPresetId: "",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 6,
      variationsPerSection: 1
    });

    if (result.ok) {
      throw new Error("Expected validation to fail.");
    }

    expect(result.fieldErrors.sentencesPerClip).toBeDefined();
    expect(result.fieldErrors.avatarPresetId).toBeDefined();
  });

  it("validateGenerationSettings rejects unknown preset IDs", () => {
    const result = validateGenerationSettings({
      outputMode: "avatar_only",
      avatarPresetId: "bad",
      voicePresetId: "bad",
      stylePresetId: "bad",
      sentencesPerClip: 2,
      variationsPerSection: 1
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.fieldErrors.avatarPresetId).toBeDefined();
    expect(result.fieldErrors.voicePresetId).toBeDefined();
    expect(result.fieldErrors.stylePresetId).toBeDefined();
  });

  it("validateGenerationSettings defaults variationsPerSection to 1 when missing", () => {
    const result = validateGenerationSettings({
      outputMode: "avatar_only",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2
    } as unknown as Parameters<typeof validateGenerationSettings>[0]);

    expect(result.ok).toBe(true);
  });

  it("validateGenerationSettings rejects invalid variationsPerSection values", () => {
    const base = {
      outputMode: "avatar_only" as const,
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2
    };

    const tooLow = validateGenerationSettings({ ...base, variationsPerSection: 0 });
    const tooHigh = validateGenerationSettings({ ...base, variationsPerSection: 6 });
    const fractional = validateGenerationSettings({ ...base, variationsPerSection: 2.5 });

    expect(tooLow.ok).toBe(false);
    expect(tooHigh.ok).toBe(false);
    expect(fractional.ok).toBe(false);
  });

  it("does not invalidate approval when settings change", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const approved = await approveProject("p1");

    const updated = setGenerationSettings("p1", {
      outputMode: "avatar_plus_slides",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1
    });

    expect(updated.status).toBe("approved");
    expect(updated.approvedManifest).toBeDefined();
    expect(updated.lastApprovedAt).toBe(approved.lastApprovedAt);
  });

  it("canGenerate enforces approval and settings", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      approvalStatus: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      },
      generationSettings: {
        outputMode: "avatar_only" as const,
        avatarPresetId: "stub_avatar_m1",
        voicePresetId: "stub_voice_en_us_1",
        stylePresetId: "stub_style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 1,
        updatedAt: "2024-01-03T00:00:00.000Z"
      }
    };

    const ok = canGenerate(project);
    expect(ok.ok).toBe(true);
  });

  it("canGenerate blocks when approvalStatus is draft", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      approvalStatus: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      },
      generationSettings: {
        outputMode: "avatar_only" as const,
        avatarPresetId: "stub_avatar_m1",
        voicePresetId: "stub_voice_en_us_1",
        stylePresetId: "stub_style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 1,
        updatedAt: "2024-01-03T00:00:00.000Z"
      }
    };

    const result = canGenerate(project);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_approved");
    }
  });

  it("updates project status when job status changes", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const started = startGenerationJob("p1", "job-1");
    expect(started.status).toBe("generating");

    const updated = updateGenerationJobStatus("p1", {
      id: "job-1",
      status: "failed",
      progress: { phase: "rendering", pct: 40 },
      updatedAt: "2024-01-02T00:00:00.000Z",
      createdAt: "2024-01-02T00:00:00.000Z"
    });
    expect(updated.status).toBe("failed");
  });

  it("adds history entry when starting a job", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    startGenerationJob("p1", "job-1");
    const updated = getProject("p1");
    expect(updated?.generationHistory?.length).toBe(1);
    expect(updated?.generationHistory?.[0].jobId).toBe("job-1");
  });

  it("updates history status and caps length", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    for (let i = 0; i < 6; i += 1) {
      startGenerationJob("p1", `job-${i}`);
    }
    updateGenerationJobStatus("p1", {
      id: "job-5",
      status: "succeeded",
      progress: { phase: "complete", pct: 100 },
      updatedAt: "2024-01-02T00:00:00.000Z",
      createdAt: "2024-01-02T00:00:00.000Z"
    });

    const updated = getProject("p1");
    expect(updated?.generationHistory?.length).toBe(5);
    expect(updated?.generationHistory?.[0].jobId).toBe("job-5");
    expect(updated?.generationHistory?.[0].status).toBe("succeeded");
  });

  it("clears generation job and restores status", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    startGenerationJob("p1", "job-1");
    const cleared = clearGenerationJob("p1");
    expect(cleared.generationJob).toBeUndefined();
    expect(cleared.status).toBe("approved");
  });

  it("clears outputs and history", () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "ready" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      },
      generationJob: {
        jobId: "job-1",
        createdAt: "2024-01-02T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z"
      },
      generationHistory: [
        {
          jobId: "job-1",
          createdAt: "2024-01-02T00:00:00.000Z",
          status: "succeeded"
        }
      ]
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const cleared = clearCloudOutputs("p1");
    expect(cleared.generationHistory).toBeUndefined();
    expect(cleared.generationJob).toBeUndefined();
    expect(cleared.status).toBe("approved");
  });

  it("deleteProjectDocx resets derived state", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "approved" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      lastApprovedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      },
      approvedManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        approvedAt: "2024-01-02T00:00:00.000Z",
        draftSignature: "sig",
        sections: [{ id: "s1", title: "Intro", script: "hello" }]
      },
      generationHistory: [
        { jobId: "job-1", createdAt: "2024-01-02T00:00:00.000Z", status: "succeeded" }
      ]
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const updated = await deleteProjectDocx("p1");
    expect(updated.draftManifest).toBeUndefined();
    expect(updated.approvedManifest).toBeUndefined();
    expect(updated.lastApprovedAt).toBeUndefined();
    expect(updated.generationHistory).toBeUndefined();
    expect(updated.generationJob).toBeUndefined();
    expect(updated.status).toBe("draft");
  });

  it("deleteProject removes project from store", async () => {
    const store = {
      version: 1 as const,
      projects: [
        {
          id: "p1",
          name: "Course A",
          status: "draft" as const,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z"
        },
        {
          id: "p2",
          name: "Course B",
          status: "draft" as const,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-02T00:00:00.000Z"
        }
      ]
    };

    localStorage.setItem(STORAGE_KEY, serializeStore(store));
    await deleteProject("p1");
    const projects = listProjects();
    expect(projects.length).toBe(1);
    expect(projects[0].id).toBe("p2");
  });

  it("setGenerationSettings persists without changing status or approval", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));
    const updated = setGenerationSettings("p1", {
      outputMode: "avatar_only",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1
    });

    expect(updated.status).toBe("needs_approval");
    expect(updated.approvedManifest).toBeUndefined();
    expect(updated.generationSettings).toBeDefined();
  });

  it("approves, saves script draft, and re-approves with updated script", async () => {
    const project = {
      id: "p1",
      name: "Course",
      status: "needs_approval" as const,
      approvalStatus: "draft" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      draftManifest: {
        manifestVersion: "0.1" as const,
        courseTitle: "Course",
        doc: {
          fileName: "doc.docx",
          fileSize: 123,
          lastModified: 1,
          storedAt: "2024-01-01T00:00:00.000Z"
        },
        sections: [
          {
            id: "s1",
            title: "Intro",
            level: 1,
            selected: true,
            script: "hello",
            mediaRefs: []
          }
        ]
      }
    };

    localStorage.setItem(STORAGE_KEY, serializeStore({ version: 1 as const, projects: [project] }));

    setGenerationSettings("p1", {
      outputMode: "avatar_only",
      avatarPresetId: "stub_avatar_m1",
      voicePresetId: "stub_voice_en_us_1",
      stylePresetId: "stub_style_clean",
      sentencesPerClip: 2,
      variationsPerSection: 1
    });

    const approved = await approveProject("p1");
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.approvedManifest?.sections[0]?.script).toBe("hello");

    const saved = saveScriptDraft("p1", "s1", "edited script");
    expect(saved.approvalStatus).toBe("draft");
    expect(saved.approvedManifest).toBeUndefined();

    const reapproved = await approveProject("p1");
    expect(reapproved.approvalStatus).toBe("approved");
    expect(reapproved.approvedManifest?.sections[0]?.script).toBe("edited script");

    const ok = canGenerate(reapproved);
    expect(ok.ok).toBe(true);
  });
});

