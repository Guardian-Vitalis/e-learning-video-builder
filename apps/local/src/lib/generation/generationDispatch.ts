import type {
  CourseVideoProject,
  CreateJobRequest,
  GenerationSettings,
  JobInputTableImage,
  ScriptCleanupMode,
  StubAvatarStyle,
  StubBackgroundStyle
} from "@evb/shared";
import { getAvatarPreset } from "@evb/shared";
import { buildGenerationInputFromDraft } from "./generationGating";
import { canGenerate } from "../storage/projectsStore";

export type GenerationGateErrorCode =
  | "APPROVAL_REQUIRED"
  | "SETTINGS_INCOMPLETE"
  | "MISSING_MANIFEST"
  | "INVALID_TARGET"
  | "SECTION_DISABLED";

export class GenerationGateError extends Error {
  code: GenerationGateErrorCode;

  constructor(code: GenerationGateErrorCode, message: string) {
    super(message);
    this.name = "GenerationGateError";
    this.code = code;
  }
}

type BuildGenerationRequestInput = {
  project: CourseVideoProject;
  effectiveSettings?: GenerationSettings;
  effectiveCleanupMode?: ScriptCleanupMode;
  stubAvatarStyle: StubAvatarStyle;
  stubBackgroundStyle: StubBackgroundStyle;
  tableImages?: JobInputTableImage[];
};

type BuildRegenerateRequestInput = BuildGenerationRequestInput & {
  targetSectionIds: string[];
};

export function assertProjectApproved(project: CourseVideoProject) {
  const approvalStatus =
    project.approvalStatus ?? (project.approvedManifest ? "approved" : "draft");
  if (approvalStatus !== "approved") {
    throw new GenerationGateError(
      "APPROVAL_REQUIRED",
      "Project must be approved before generation."
    );
  }
}

export function buildGenerationJobRequest({
  project,
  effectiveSettings,
  effectiveCleanupMode,
  stubAvatarStyle,
  stubBackgroundStyle,
  tableImages
}: BuildGenerationRequestInput): CreateJobRequest {
  assertProjectApproved(project);
  const eligibility = canGenerate(project);
  if (!eligibility.ok) {
    const message =
      eligibility.reason === "missing_manifest"
        ? "Approved manifest missing."
        : "Generation settings incomplete.";
    const code: GenerationGateErrorCode =
      eligibility.reason === "missing_manifest"
        ? "MISSING_MANIFEST"
        : eligibility.reason === "settings_incomplete"
          ? "SETTINGS_INCOMPLETE"
          : "APPROVAL_REQUIRED";
    throw new GenerationGateError(code, message);
  }
  if (!effectiveSettings) {
    throw new GenerationGateError("SETTINGS_INCOMPLETE", "Generation settings incomplete.");
  }
  if (!project.approvedManifest) {
    throw new GenerationGateError("MISSING_MANIFEST", "Approved manifest missing.");
  }

  const draftInput = project.draftManifest
    ? buildGenerationInputFromDraft(project.draftManifest, project.outlineDisabledIds)
    : null;
  const avatarPreset = getAvatarPreset(effectiveSettings.avatarPresetId);
  const clipPlannerMode = project.clipPlanner?.avatarMode;
  const clipPlannerPrepared =
    clipPlannerMode === "prepared" ? project.clipPlanner.preparedAvatar : undefined;
  const manifestPrepared = project.approvedManifest?.localAvatar;
  const allowManifestPrepared = !clipPlannerMode || clipPlannerMode === "prepared";
  const preparedFromManifest =
    allowManifestPrepared && manifestPrepared && manifestPrepared.kind === "prepared"
      ? {
          avatarId: manifestPrepared.avatarId,
          fps: manifestPrepared.fps,
          bboxShift: manifestPrepared.bboxShift
        }
      : undefined;
  const resolvedPrepared = clipPlannerPrepared ?? preparedFromManifest;
  const localAvatarAdvanced = resolvedPrepared
    ? {
        avatarId: resolvedPrepared.avatarId,
        fps: resolvedPrepared.fps,
        bboxShift: resolvedPrepared.bboxShift
      }
    : avatarPreset?.provider === "local_musetalk"
      ? project.localAvatarAdvanced
      : undefined;

  return {
    projectId: project.id,
    manifest: project.approvedManifest,
    scriptCleanupMode: effectiveCleanupMode,
    cleanupConfigOverrides: project.cleanupConfigOverrides,
    stubAvatarStyle,
    stubBackgroundStyle,
    localAvatarAdvanced,
    sourceDoc: project.sourceDoc ?? draftInput?.sourceDoc,
    selectedSectionIds: project.selectedSectionIds ?? draftInput?.selectedSectionIds,
    settings: effectiveSettings,
    tableImages
  };
}

export function buildRegenerateJobRequest({
  project,
  effectiveSettings,
  effectiveCleanupMode,
  stubAvatarStyle,
  stubBackgroundStyle,
  tableImages,
  targetSectionIds
}: BuildRegenerateRequestInput): CreateJobRequest {
  const base = buildGenerationJobRequest({
    project,
    effectiveSettings,
    effectiveCleanupMode,
    stubAvatarStyle,
    stubBackgroundStyle,
    tableImages
  });
  if (!targetSectionIds || targetSectionIds.length === 0) {
    throw new GenerationGateError("INVALID_TARGET", "Select a section to regenerate.");
  }
  const disabled = project.outlineDisabledIds ?? [];
  const disabledTargets = targetSectionIds.filter((id) => disabled.includes(id));
  if (disabledTargets.length > 0) {
    throw new GenerationGateError(
      "SECTION_DISABLED",
      "Selected section is disabled and cannot be regenerated."
    );
  }
  const approvedIds = new Set(project.approvedManifest?.sections.map((section) => section.id) ?? []);
  const invalidTargets = targetSectionIds.filter((id) => !approvedIds.has(id));
  if (invalidTargets.length > 0) {
    throw new GenerationGateError(
      "INVALID_TARGET",
      "Selected section is not part of the approved manifest."
    );
  }
  return {
    ...base,
    targetSectionIds: targetSectionIds.slice()
  };
}
