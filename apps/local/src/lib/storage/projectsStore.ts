import {
  ApprovedManifest,
  CourseVideoProject,
  DraftManifest,
  GenerationJobRef,
  GenerationSettings,
  JobRecord,
  JobSectionProgress,
  LocalAvatarManifestBlock,
  LocalAvatarPreparedState,
  LocalAvatarAdvancedSettings,
  ClipPlannerSettings,
  ClipPlannerPreparedAvatar,
  ProjectGenerationHistoryItem,
  ScriptDraftMeta,
  TableImageAttachment,
  ProjectStatus,
  DocxSourceDoc,
  ProjectSettingsOverrides,
  CleanupConfig,
  CleanupMode,
  StubAvatarStyle,
  StubBackgroundStyle,
  ApprovalStatus,
  getAvatarPreset,
  getVoicePreset,
  getStylePreset
} from "@evb/shared";
import { deleteDocx } from "./docxStore";
import { deleteTableImagesForProject } from "./tableImageStore";
import {
  getEffectiveScriptForNode,
  applyScriptDraftSave
} from "../script/effectiveScript";
import { buildScriptHashMetadata } from "../script/scriptHashing";

export const STORAGE_KEY = "evb_projects_v1";

export class CorruptStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptStorageError";
  }
}

export class ValidationError extends Error {
  fieldErrors?: Record<string, string>;

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

type ProjectCaptionLanguage = "en" | "fr";

type ProjectSettings = {
  captionLanguage?: ProjectCaptionLanguage;
};

type StoredProject = CourseVideoProject & {
  settings?: ProjectSettings;
};

type ProjectStore = {
  version: 1;
  projects: StoredProject[];
};

function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    value === "draft" ||
    value === "needs_approval" ||
    value === "approved" ||
    value === "generating" ||
    value === "ready" ||
    value === "failed"
  );
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return value === "draft" || value === "approved";
}

function isValidProjectSettings(value: unknown): value is ProjectSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as ProjectSettings;
  return (
    record.captionLanguage === undefined ||
    record.captionLanguage === "en" ||
    record.captionLanguage === "fr"
  );
}

function isValidApprovedManifest(value: ApprovedManifest): boolean {
  return (
    value.manifestVersion === "0.1" &&
    typeof value.courseTitle === "string" &&
    typeof value.approvedAt === "string" &&
    typeof value.draftSignature === "string" &&
    Array.isArray(value.sections) &&
    (value.settings === undefined || isValidGenerationSettings(value.settings)) &&
    value.sections.every(
      (section) =>
        typeof section.id === "string" &&
        typeof section.title === "string" &&
        typeof section.script === "string"
    )
    && (value.localAvatar === undefined || isValidPreparedLocalAvatar(value.localAvatar))
  );
}

function isValidProject(value: unknown): value is StoredProject {
  if (!value || typeof value !== "object") {
    return false;
  }
  const project = value as StoredProject;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    (project.description === undefined || typeof project.description === "string") &&
    isProjectStatus(project.status) &&
    (project.approvalStatus === undefined || isApprovalStatus(project.approvalStatus)) &&
    (project.approvedAt === undefined || typeof project.approvedAt === "string") &&
    (project.approvedBy === undefined || typeof project.approvedBy === "string") &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string" &&
    (project.lastApprovedAt === undefined || typeof project.lastApprovedAt === "string") &&
    (project.approvedScriptHashByNodeId === undefined ||
      isValidHashMap(project.approvedScriptHashByNodeId)) &&
    (project.approvedSentenceHashesByNodeId === undefined ||
      isValidSentenceHashMap(project.approvedSentenceHashesByNodeId)) &&
    isValidHashAlgo(project.approvedScriptHashAlgo) &&
    (project.generationSettings === undefined ||
      isValidGenerationSettings(project.generationSettings)) &&
    (project.localAvatarAdvanced === undefined ||
      isValidLocalAvatarAdvanced(project.localAvatarAdvanced)) &&
    (project.localAvatar === undefined ||
      isValidLocalAvatarPrepared(project.localAvatar)) &&
    (project.clipPlanner === undefined ||
      isValidClipPlannerSettings(project.clipPlanner)) &&
    (project.projectSettingsOverrides === undefined ||
      isValidProjectSettingsOverrides(project.projectSettingsOverrides)) &&
    (project.scriptCleanupMode === undefined ||
      isValidCleanupMode(project.scriptCleanupMode)) &&
    (project.cleanupConfigOverrides === undefined ||
      isValidCleanupConfigOverrides(project.cleanupConfigOverrides)) &&
    (project.stubAvatarStyle === undefined ||
      isValidStubAvatarStyle(project.stubAvatarStyle)) &&
    (project.stubBackgroundStyle === undefined ||
      isValidStubBackgroundStyle(project.stubBackgroundStyle)) &&
    (project.settings === undefined || isValidProjectSettings(project.settings)) &&
    (project.generationJob === undefined || isValidGenerationJob(project.generationJob)) &&
    (project.generationHistory === undefined ||
      isValidGenerationHistory(project.generationHistory)) &&
    (project.draftManifest === undefined || isValidDraftManifest(project.draftManifest)) &&
    (project.approvedManifest === undefined || isValidApprovedManifest(project.approvedManifest)) &&
    (project.sourceDoc === undefined || isValidDocxSourceDoc(project.sourceDoc)) &&
    (project.selectedSectionIds === undefined ||
      project.selectedSectionIds.every((id) => typeof id === "string")) &&
    (project.outlineDisabledIds === undefined ||
      isValidOutlineDisabledIds(project.outlineDisabledIds)) &&
    (project.scriptEditsByNodeId === undefined ||
      isValidScriptDrafts(project.scriptEditsByNodeId)) &&
    (project.scriptDraftMeta === undefined ||
      isValidScriptDraftMeta(project.scriptDraftMeta))
  );
}

function isValidDocMeta(value: DraftManifest["doc"]): boolean {
  return (
    typeof value.fileName === "string" &&
    typeof value.fileSize === "number" &&
    typeof value.lastModified === "number" &&
    typeof value.storedAt === "string"
  );
}

function isValidDocxSourceDoc(value: DocxSourceDoc): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(value.sections) &&
    value.sections.every(
      (section) =>
        typeof section.sectionId === "string" &&
        typeof section.heading === "string" &&
        typeof section.text === "string" &&
        (section.level === 1 || section.level === 2 || section.level === 3)
    )
  );
}

function isValidProjectSettingsOverrides(value: ProjectSettingsOverrides): boolean {
  return (
    typeof value.sentencesPerClip === "number" &&
    typeof value.variationsPerSection === "number" &&
    Number.isInteger(value.sentencesPerClip) &&
    Number.isInteger(value.variationsPerSection) &&
    value.sentencesPerClip >= 1 &&
    value.sentencesPerClip <= 5 &&
    value.variationsPerSection >= 1 &&
    value.variationsPerSection <= 5
  );
}

function isValidLocalAvatarAdvanced(value: LocalAvatarAdvancedSettings): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as LocalAvatarAdvancedSettings;
  const avatarOk =
    record.avatarId === undefined ||
    (typeof record.avatarId === "string" && record.avatarId.trim().length > 0);
  const fpsOk =
    record.fps === undefined ||
    (typeof record.fps === "number" && Number.isFinite(record.fps) && record.fps > 0);
  const bboxOk =
    record.bboxShift === undefined ||
    (typeof record.bboxShift === "number" &&
      Number.isFinite(record.bboxShift) &&
      Number.isInteger(record.bboxShift));
  return avatarOk && fpsOk && bboxOk;
}

function isValidLocalAvatarPrepared(value: LocalAvatarPreparedState): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const avatarOk = typeof value.avatarId === "string" && value.avatarId.trim().length > 0;
  const fpsOk = typeof value.fps === "number" && Number.isFinite(value.fps) && value.fps > 0;
  const bboxOk =
    typeof value.bboxShift === "number" &&
    Number.isFinite(value.bboxShift) &&
    Number.isInteger(value.bboxShift);
  const prepKeyOk = value.prepKey === undefined || typeof value.prepKey === "string";
  const lastPreparedOk =
    value.lastPreparedAt === undefined || typeof value.lastPreparedAt === "string";
  const cacheHitOk = value.lastCacheHit === undefined || typeof value.lastCacheHit === "boolean";
  const refOk = value.refImageDataUrl === undefined || typeof value.refImageDataUrl === "string";
  return avatarOk && fpsOk && bboxOk && prepKeyOk && lastPreparedOk && cacheHitOk && refOk;
}

function isValidCleanupMode(value: CleanupMode): boolean {
  return value === "off" || value === "deterministic" || value === "llm";
}

function isValidStubAvatarStyle(value: StubAvatarStyle): boolean {
  return (
    value === "silhouette" ||
    value === "illustration" ||
    value === "photo" ||
    value === "badge"
  );
}

function isValidStubBackgroundStyle(value: StubBackgroundStyle): boolean {
  return value === "neutral" || value === "gradient" || value === "classroom";
}

function isValidCleanupConfigOverrides(value: Partial<CleanupConfig>): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<CleanupConfig>;
  const isBool = (input: unknown) =>
    input === undefined || typeof input === "boolean";
  const isNumber = (input: unknown) =>
    input === undefined || (typeof input === "number" && Number.isFinite(input));
  const isMap = (input: unknown) =>
    input === undefined ||
    (typeof input === "object" &&
      input !== null &&
      Object.values(input).every((val) => typeof val === "string"));
  return (
    isBool(record.expandAbbreviations) &&
    isMap(record.abbreviations) &&
    isNumber(record.maxWordsPerSentence) &&
    isNumber(record.maxLineChars) &&
    isBool(record.addPauses) &&
    isBool(record.synonymSubstitutions) &&
    isNumber(record.substitutionRate)
  );
}

function isValidOutlineDisabledIds(value: string[]): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isValidScriptDrafts(value: Record<string, string>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function isValidHashMap(value: Record<string, string>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === "string");
}

function isValidSentenceHashMap(value: Record<string, string[]>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((hash) => typeof hash === "string")
  );
}

function isValidHashAlgo(value: unknown): value is "sha256" | undefined {
  return value === undefined || value === "sha256";
}

function isValidScriptDraftMeta(value: ScriptDraftMeta): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { updatedAt, dirtyNodeIds } = value;
  const validDirtyIds =
    dirtyNodeIds === undefined ||
    (Array.isArray(dirtyNodeIds) && dirtyNodeIds.every((id) => typeof id === "string"));
  return typeof updatedAt === "string" && validDirtyIds;
}

function buildScriptDraftMeta(
  edits?: Record<string, string>
): ScriptDraftMeta | undefined {
  if (!edits) {
    return undefined;
  }
  const ids = Object.keys(edits);
  if (ids.length === 0) {
    return undefined;
  }
  return {
    updatedAt: nowIso(),
    dirtyNodeIds: ids
  };
}

function isValidDraftSection(value: DraftManifest["sections"][number]): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.level === "number" &&
    typeof value.selected === "boolean" &&
    typeof value.script === "string" &&
    Array.isArray(value.mediaRefs) &&
    value.mediaRefs.every((ref) => typeof ref === "string") &&
    (value.tableImages === undefined || value.tableImages.every(isValidTableImageAttachment))
  );
}

function isValidClipPlannerPreparedAvatar(value: ClipPlannerPreparedAvatar): boolean {
  return (
    value &&
    typeof value === "object" &&
    typeof value.avatarId === "string" &&
    value.avatarId.trim().length > 0 &&
    typeof value.fps === "number" &&
    Number.isFinite(value.fps) &&
    value.fps > 0 &&
    typeof value.bboxShift === "number" &&
    Number.isFinite(value.bboxShift)
  );
}

function isValidClipPlannerSettings(value: ClipPlannerSettings): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value.avatarMode !== "none" && value.avatarMode !== "prepared") {
    return false;
  }
  if (value.avatarMode === "prepared") {
    if (!value.preparedAvatar) {
      return false;
    }
    if (!isValidClipPlannerPreparedAvatar(value.preparedAvatar)) {
      return false;
    }
  }
  return true;
}

function isValidPreparedLocalAvatar(value: LocalAvatarManifestBlock): boolean {
  return (
    value &&
    typeof value === "object" &&
    value.kind === "prepared" &&
    typeof value.avatarId === "string" &&
    value.avatarId.trim().length > 0 &&
    typeof value.fps === "number" &&
    Number.isFinite(value.fps) &&
    value.fps > 0 &&
    typeof value.bboxShift === "number" &&
    Number.isFinite(value.bboxShift)
  );
}

function isValidDraftManifest(value: DraftManifest): boolean {
  return (
    value.manifestVersion === "0.1" &&
    typeof value.courseTitle === "string" &&
    isValidDocMeta(value.doc) &&
    Array.isArray(value.sections) &&
    value.sections.every(isValidDraftSection)
    && (value.localAvatar === undefined || isValidPreparedLocalAvatar(value.localAvatar))
  );
}

function isValidTableImageAttachment(value: TableImageAttachment): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.sectionId === "string" &&
    typeof value.tableIndex === "number" &&
    typeof value.rowIndex === "number" &&
    typeof value.cellIndex === "number" &&
    typeof value.anchorText === "string" &&
    typeof value.relId === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string"
  );
}

function isValidStore(value: unknown): value is ProjectStore {
  if (!value || typeof value !== "object") {
    return false;
  }
  const store = value as ProjectStore;
  return (
    store.version === 1 &&
    Array.isArray(store.projects) &&
    store.projects.every(isValidProject)
  );
}

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new Error("localStorage unavailable");
  }
  return window.localStorage;
}

function readStore(): ProjectStore | null {
  const storage = getStorage();
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  return parseStore(raw);
}

function writeStore(store: ProjectStore) {
  const storage = getStorage();
  storage.setItem(STORAGE_KEY, serializeStore(store));
}

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function validateName(rawName: string) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) {
    throw new ValidationError("Name must be between 2 and 80 characters.");
  }
  return name;
}

function validateDescription(rawDescription?: string) {
  if (rawDescription === undefined) {
    return undefined;
  }
  const description = rawDescription.trim();
  if (description.length === 0) {
    return undefined;
  }
  if (description.length > 280) {
    throw new ValidationError("Description must be 280 characters or fewer.");
  }
  return description;
}

function isValidGenerationSettings(value: GenerationSettings): boolean {
  const variations =
    (value as { variationsPerSection?: number }).variationsPerSection ?? 1;
  return (
    (value.outputMode === "avatar_only" || value.outputMode === "avatar_plus_slides") &&
    typeof value.avatarPresetId === "string" &&
    typeof value.voicePresetId === "string" &&
    typeof value.stylePresetId === "string" &&
    Boolean(getAvatarPreset(value.avatarPresetId)) &&
    Boolean(getVoicePreset(value.voicePresetId)) &&
    Boolean(getStylePreset(value.stylePresetId)) &&
    typeof value.sentencesPerClip === "number" &&
    Number.isInteger(variations) &&
    variations >= 1 &&
    variations <= 5 &&
    typeof value.updatedAt === "string"
  );
}

function isValidJobStatus(value: JobRecord): boolean {
  const artifactsOk =
    value.artifacts === undefined ||
    (typeof value.artifacts.mp4Path === "string" &&
      typeof value.artifacts.vttPath === "string" &&
      typeof value.artifacts.srtPath === "string" &&
      typeof value.artifacts.expiresAt === "string");
  const sectionsOk =
    value.sectionsProgress === undefined ||
    value.sectionsProgress.every(isValidJobSectionProgress);

  return (
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    value.progress !== null &&
    typeof value.progress === "object" &&
    typeof value.progress.phase === "string" &&
    typeof value.progress.pct === "number" &&
    typeof value.updatedAt === "string" &&
    typeof value.createdAt === "string" &&
    artifactsOk &&
    sectionsOk
  );
}

function isValidJobSectionProgress(value: JobSectionProgress): boolean {
  return (
    typeof value.sectionId === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    typeof value.phase === "string" &&
    typeof value.pct === "number" &&
    (value.error === undefined ||
      (typeof value.error.message === "string" &&
        (value.error.details === undefined || typeof value.error.details === "string")))
  );
}

function isValidGenerationJob(value: GenerationJobRef): boolean {
  return (
    typeof value.jobId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.instanceId === undefined || typeof value.instanceId === "string") &&
    (value.lastStatus === undefined || isValidJobStatus(value.lastStatus))
  );
}

function isValidGenerationHistoryItem(value: ProjectGenerationHistoryItem): boolean {
  return (
    typeof value.jobId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.status === "string" &&
    (value.completedAt === undefined || typeof value.completedAt === "string") &&
    (value.mp4Path === undefined || typeof value.mp4Path === "string") &&
    (value.vttPath === undefined || typeof value.vttPath === "string") &&
    (value.srtPath === undefined || typeof value.srtPath === "string")
  );
}

function isValidGenerationHistory(
  value: ProjectGenerationHistoryItem[]
): boolean {
  return Array.isArray(value) && value.every(isValidGenerationHistoryItem);
}

export function validateGenerationSettings(
  input: Omit<GenerationSettings, "updatedAt">
): { ok: true } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const variations = input.variationsPerSection ?? 1;
  if (input.outputMode !== "avatar_only" && input.outputMode !== "avatar_plus_slides") {
    fieldErrors.outputMode = "Select an output mode.";
  }
  if (!input.avatarPresetId.trim() || !getAvatarPreset(input.avatarPresetId)) {
    fieldErrors.avatarPresetId = "Choose a valid avatar preset.";
  }
  if (!input.voicePresetId.trim() || !getVoicePreset(input.voicePresetId)) {
    fieldErrors.voicePresetId = "Choose a valid voice preset.";
  }
  if (!input.stylePresetId.trim() || !getStylePreset(input.stylePresetId)) {
    fieldErrors.stylePresetId = "Choose a valid style preset.";
  }
  if (!Number.isInteger(input.sentencesPerClip) || input.sentencesPerClip < 1 || input.sentencesPerClip > 5) {
    fieldErrors.sentencesPerClip = "Sentences per clip must be between 1 and 5.";
  }
  if (!Number.isInteger(variations) || variations < 1 || variations > 5) {
    fieldErrors.variationsPerSection = "Variations per section must be between 1 and 5.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true };
}

function normalizeGenerationSettings(
  settings?: GenerationSettings
): GenerationSettings | undefined {
  if (!settings) {
    return undefined;
  }
  return {
    ...settings,
    variationsPerSection: settings.variationsPerSection ?? 1
  };
}

function normalizeClipPlannerSettings(
  settings?: ClipPlannerSettings
): ClipPlannerSettings {
  const mode = settings?.avatarMode === "prepared" ? "prepared" : "none";
  const preparedAvatar =
    mode === "prepared" && settings?.preparedAvatar
      ? isValidClipPlannerPreparedAvatar(settings.preparedAvatar)
        ? settings.preparedAvatar
        : undefined
      : undefined;
  return {
    avatarMode: mode,
    preparedAvatar
  };
}

function clipPlannerEquals(a?: ClipPlannerSettings, b?: ClipPlannerSettings): boolean {
  const left = normalizeClipPlannerSettings(a);
  const right = normalizeClipPlannerSettings(b);
  if (left.avatarMode !== right.avatarMode) {
    return false;
  }
  if (left.avatarMode !== "prepared") {
    return true;
  }
  const leftAvatar = left.preparedAvatar;
  const rightAvatar = right.preparedAvatar;
  if (!leftAvatar || !rightAvatar) {
    return false;
  }
  return (
    leftAvatar.avatarId === rightAvatar.avatarId &&
    leftAvatar.fps === rightAvatar.fps &&
    leftAvatar.bboxShift === rightAvatar.bboxShift &&
    leftAvatar.refImageDataUrl === rightAvatar.refImageDataUrl
  );
}

function normalizeProject(project: StoredProject): StoredProject {
  const approvalStatus =
    project.approvalStatus ??
    (project.approvedManifest ? "approved" : "draft");
  const approvedAt =
    project.approvedAt ??
    project.approvedManifest?.approvedAt ??
    project.lastApprovedAt;
  const legacyEnabledIds =
    (project as CourseVideoProject & { outlineEnabledIds?: Record<string, boolean> })
      .outlineEnabledIds;
  const legacyDisabledIds = legacyEnabledIds
    ? Object.entries(legacyEnabledIds)
        .filter(([, enabled]) => !enabled)
        .map(([id]) => id)
    : undefined;
  const outlineDisabledIds =
    project.outlineDisabledIds ??
    legacyDisabledIds ??
    (project.draftManifest ? buildOutlineDisabledIds(project.draftManifest) : undefined);
  const scriptEditsByNodeId =
    project.scriptEditsByNodeId && Object.keys(project.scriptEditsByNodeId).length > 0
      ? project.scriptEditsByNodeId
      : undefined;
  const scriptDraftMeta =
    scriptEditsByNodeId && project.scriptDraftMeta ? project.scriptDraftMeta : undefined;
  const normalizedClipPlanner = normalizeClipPlannerSettings(project.clipPlanner);

  if (!project.generationSettings) {
    return {
      ...project,
      approvalStatus,
      approvedAt,
      outlineDisabledIds,
      scriptEditsByNodeId,
      scriptDraftMeta,
      clipPlanner: normalizedClipPlanner
    };
  }
  const normalized = normalizeGenerationSettings(project.generationSettings);
  const clipPlannerMatches = clipPlannerEquals(project.clipPlanner, normalizedClipPlanner);
  if (
    normalized === project.generationSettings &&
    approvalStatus === project.approvalStatus &&
    approvedAt === project.approvedAt &&
    outlineDisabledIds === project.outlineDisabledIds &&
    scriptEditsByNodeId === project.scriptEditsByNodeId &&
    clipPlannerMatches &&
    scriptDraftMeta === project.scriptDraftMeta
  ) {
    return project;
  }
  return {
    ...project,
    generationSettings: normalized,
    approvalStatus,
    approvedAt,
    outlineDisabledIds,
    scriptEditsByNodeId,
    scriptDraftMeta,
    clipPlanner: normalizedClipPlanner
  };
}

export function listProjects(): StoredProject[] {
  const store = readStore();
  if (!store) {
    return [];
  }
  return store.projects.map(normalizeProject);
}

export function getProject(projectId: string): StoredProject | null {
  const projects = listProjects();
  return projects.find((project) => project.id === projectId) ?? null;
}

export function createProject(input: {
  name: string;
  description?: string;
}): StoredProject {
  const store = readStore() ?? { version: 1, projects: [] };
  const name = validateName(input.name);
  const description = validateDescription(input.description);
  const timestamp = nowIso();
  const project: StoredProject = {
    id: createId(),
    name,
    description,
    status: "draft",
    approvalStatus: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    clipPlanner: { avatarMode: "none" },
    settings: { captionLanguage: "en" }
  };
  const next: ProjectStore = {
    version: 1,
    projects: [project, ...store.projects]
  };
  writeStore(next);
  return project;
}

export function updateProject(
  patch: Partial<StoredProject> & { id: string }
): StoredProject {
  const store = readStore() ?? { version: 1, projects: [] };
  const index = store.projects.findIndex((project) => project.id === patch.id);
  if (index === -1) {
    throw new ValidationError("Project not found.");
  }

  const current = store.projects[index];
  let next: StoredProject = {
    ...current,
    ...patch,
    name: patch.name !== undefined ? validateName(patch.name) : current.name,
    description:
      patch.description !== undefined
        ? validateDescription(patch.description)
        : current.description,
    updatedAt: nowIso()
  };

  if ("generationSettings" in patch && patch.generationSettings) {
    const { updatedAt: _updatedAt, ...rest } = patch.generationSettings;
    const validation = validateGenerationSettings(rest);
    if (!validation.ok) {
      throw new ValidationError("Generation settings are invalid.", validation.fieldErrors);
    }
  }
  if ("projectSettingsOverrides" in patch && patch.projectSettingsOverrides) {
    if (!isValidProjectSettingsOverrides(patch.projectSettingsOverrides)) {
      throw new ValidationError("Project overrides are invalid.");
    }
  }
  if ("localAvatarAdvanced" in patch && patch.localAvatarAdvanced) {
    if (!isValidLocalAvatarAdvanced(patch.localAvatarAdvanced)) {
      throw new ValidationError("Local avatar advanced settings are invalid.");
  }
  }
  if ("localAvatar" in patch && patch.localAvatar) {
    if (!isValidLocalAvatarPrepared(patch.localAvatar)) {
      throw new ValidationError("Local avatar metadata is invalid.");
    }
  }
  if ("scriptCleanupMode" in patch && patch.scriptCleanupMode) {
    if (!isValidCleanupMode(patch.scriptCleanupMode)) {
      throw new ValidationError("Cleanup mode is invalid.");
    }
  }
  if ("cleanupConfigOverrides" in patch && patch.cleanupConfigOverrides) {
    if (!isValidCleanupConfigOverrides(patch.cleanupConfigOverrides)) {
      throw new ValidationError("Cleanup config overrides are invalid.");
    }
  }
  if ("stubAvatarStyle" in patch && patch.stubAvatarStyle) {
    if (!isValidStubAvatarStyle(patch.stubAvatarStyle)) {
      throw new ValidationError("Stub avatar style is invalid.");
    }
  }
  if ("stubBackgroundStyle" in patch && patch.stubBackgroundStyle) {
    if (!isValidStubBackgroundStyle(patch.stubBackgroundStyle)) {
      throw new ValidationError("Stub background style is invalid.");
    }
  }
  if ("settings" in patch && patch.settings !== undefined) {
    if (!isValidProjectSettings(patch.settings)) {
      throw new ValidationError("Project settings are invalid.");
    }
  }
  if ("approvalStatus" in patch && patch.approvalStatus) {
    if (!isApprovalStatus(patch.approvalStatus)) {
      throw new ValidationError("Approval status is invalid.");
    }
  }
  if ("outlineDisabledIds" in patch && patch.outlineDisabledIds) {
    if (!isValidOutlineDisabledIds(patch.outlineDisabledIds)) {
      throw new ValidationError("Outline selection is invalid.");
    }
  }
  if ("scriptEditsByNodeId" in patch && patch.scriptEditsByNodeId) {
    if (!isValidScriptDrafts(patch.scriptEditsByNodeId)) {
      throw new ValidationError("Script drafts are invalid.");
    }
  }
  if ("scriptDraftMeta" in patch && patch.scriptDraftMeta) {
    if (!isValidScriptDraftMeta(patch.scriptDraftMeta)) {
      throw new ValidationError("Script draft metadata is invalid.");
    }
  }
  if ("approvedScriptHashByNodeId" in patch && patch.approvedScriptHashByNodeId) {
    if (!isValidHashMap(patch.approvedScriptHashByNodeId)) {
      throw new ValidationError("Approved script hashes are invalid.");
    }
  }
  if ("approvedSentenceHashesByNodeId" in patch && patch.approvedSentenceHashesByNodeId) {
    if (!isValidSentenceHashMap(patch.approvedSentenceHashesByNodeId)) {
      throw new ValidationError("Approved sentence hashes are invalid.");
    }
  }
  if ("approvedScriptHashAlgo" in patch) {
    if (!isValidHashAlgo(patch.approvedScriptHashAlgo)) {
      throw new ValidationError("Approved script hash algo is invalid.");
    }
  }

  if ("draftManifest" in patch) {
    const nextOutlineDisabledIds =
      patch.draftManifest === undefined
        ? undefined
        : patch.outlineDisabledIds ?? buildOutlineDisabledIds(patch.draftManifest);
    next = {
      ...next,
      status: "needs_approval",
      approvalStatus: "draft",
      approvedAt: undefined,
      approvedBy: undefined,
      approvedManifest: undefined,
      outlineDisabledIds: nextOutlineDisabledIds,
      scriptEditsByNodeId: undefined,
      scriptDraftMeta: undefined,
      generationJob: undefined,
      generationHistory: undefined
    };
  }

  if ("outlineDisabledIds" in patch && !("draftManifest" in patch)) {
    next = {
      ...next,
      status: "needs_approval",
      approvalStatus: "draft",
      approvedAt: undefined,
      approvedBy: undefined,
      approvedManifest: undefined,
      generationJob: undefined,
      generationHistory: undefined
    };
    if (patch.selectedSectionIds === undefined && current.draftManifest) {
      next = {
        ...next,
        selectedSectionIds: getSelectedSectionIds(
          current.draftManifest,
          patch.outlineDisabledIds ?? current.outlineDisabledIds
        )
      };
    }
  }

  if ("approvedManifest" in patch && patch.approvedManifest) {
    next = {
      ...next,
      status: "approved",
      approvalStatus: "approved",
      approvedAt: patch.approvedManifest.approvedAt,
      lastApprovedAt: patch.approvedManifest.approvedAt
    };
  }

  const updated = [...store.projects];
  updated[index] = next;
  writeStore({ version: 1, projects: updated });
  return next;
}

export function resetProjects() {
  const storage = getStorage();
  storage.removeItem(STORAGE_KEY);
}

export function parseStore(raw: string): ProjectStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CorruptStorageError("Stored project data is not valid JSON.");
  }
  if (!isValidStore(parsed)) {
    throw new CorruptStorageError("Stored project data has an invalid shape.");
  }
  return parsed;
}

export function serializeStore(store: ProjectStore): string {
  return JSON.stringify(store);
}

function stableDraftPayload(draftManifest: DraftManifest) {
  return {
    manifestVersion: draftManifest.manifestVersion,
    courseTitle: draftManifest.courseTitle,
    doc: {
      fileName: draftManifest.doc.fileName,
      fileSize: draftManifest.doc.fileSize,
      lastModified: draftManifest.doc.lastModified,
      storedAt: draftManifest.doc.storedAt
    },
    sections: draftManifest.sections.map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      selected: section.selected,
      script: section.script,
      mediaRefs: section.mediaRefs
    })),
    localAvatar: draftManifest.localAvatar ?? null
  };
}

function clipPlannerAvatarFromLocal(
  state: LocalAvatarPreparedState
): ClipPlannerPreparedAvatar {
  return {
    avatarId: state.avatarId,
    fps: state.fps,
    bboxShift: state.bboxShift,
    refImageDataUrl: state.refImageDataUrl ?? null
  };
}

function simpleHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

export async function computeDraftSignature(draftManifest: DraftManifest): Promise<string> {
  const payload = JSON.stringify(stableDraftPayload(draftManifest));
  if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  }
  return `${payload.length}_${simpleHash(payload)}`;
}

export async function buildApprovedManifest(
  projectName: string,
  draftManifest: DraftManifest,
  settings?: GenerationSettings,
  cleanupMode?: CleanupMode,
  outlineDisabledIds?: string[],
  scriptEditsByNodeId?: Record<string, string>,
  localAvatarState?: ClipPlannerPreparedAvatar | LocalAvatarPreparedState
): Promise<ApprovedManifest> {
  const approvedAt = nowIso();
  const draftSignature = await computeDraftSignature(draftManifest);
  const sections = getEnabledSections(draftManifest, outlineDisabledIds).map((section) => ({
    id: section.id,
    title: section.title,
    script: getEffectiveScriptForNode({
      nodeId: section.id,
      baseScript: section.script,
      scriptEditsByNodeId
    })
  }));
  const localAvatarBlock =
    localAvatarState === undefined
      ? undefined
      : {
          kind: "prepared" as const,
          avatarId: localAvatarState.avatarId,
          fps: localAvatarState.fps,
          bboxShift: localAvatarState.bboxShift
        };
  return {
    manifestVersion: "0.1",
    courseTitle: projectName,
    approvedAt,
    draftSignature,
    sections,
    settings: settings ? normalizeGenerationSettings(settings) : undefined,
    cleanupMode,
    localAvatar: localAvatarBlock
  };
}

export async function approveProject(projectId: string): Promise<CourseVideoProject> {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  if (!project.draftManifest) {
    throw new ValidationError("Draft manifest is missing.");
  }
  if (getSelectedSectionCount(project.draftManifest, project.outlineDisabledIds) === 0) {
    throw new ValidationError("No sections selected.");
  }
  const clipPlannerPreparedAvatar =
    project.clipPlanner?.avatarMode === "prepared"
      ? project.clipPlanner.preparedAvatar
      : undefined;
  const preparedAvatarForManifest = clipPlannerPreparedAvatar;
  const approvedManifest = await buildApprovedManifest(
    project.name,
    project.draftManifest,
    project.generationSettings,
    project.scriptCleanupMode,
    project.outlineDisabledIds,
    project.scriptEditsByNodeId,
    preparedAvatarForManifest
  );
  const approvedScriptHashByNodeId: Record<string, string> = {};
  const approvedSentenceHashesByNodeId: Record<string, string[]> = {};
  let approvedScriptHashAlgo: "sha256" | undefined;
  for (const section of project.draftManifest.sections) {
    const script = getEffectiveScriptForNode({
      nodeId: section.id,
      baseScript: section.script,
      scriptEditsByNodeId: project.scriptEditsByNodeId
    });
    const meta = await buildScriptHashMetadata(script, approvedScriptHashAlgo);
    approvedScriptHashByNodeId[section.id] = meta.scriptHash;
    approvedSentenceHashesByNodeId[section.id] = meta.sentenceHashes;
    approvedScriptHashAlgo = meta.algo;
  }
  return updateProject({
    id: projectId,
    approvedManifest,
    status: "approved",
    approvalStatus: "approved",
    approvedAt: approvedManifest.approvedAt,
    approvedScriptHashByNodeId,
    approvedSentenceHashesByNodeId,
    approvedScriptHashAlgo
  });
}

export function saveScriptDraft(
  projectId: string,
  sectionId: string,
  script: string
): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const baseScript =
    project.draftManifest?.sections.find((section) => section.id === sectionId)?.script ??
    script;
  const {
    scriptEditsByNodeId,
    nextApprovalStatus,
    nextApprovedAt
  } = applyScriptDraftSave({
    nodeId: sectionId,
    baseScript,
    scriptText: script,
    scriptEditsByNodeId: project.scriptEditsByNodeId,
    currentApprovalStatus: project.approvalStatus,
    currentApprovedAt: project.approvedAt
  });
  const scriptDraftMeta = buildScriptDraftMeta(scriptEditsByNodeId);

  return updateProject({
    id: projectId,
    scriptEditsByNodeId,
    scriptDraftMeta,
    status: "needs_approval",
    approvalStatus: nextApprovalStatus ?? "draft",
    approvedAt: nextApprovedAt,
    approvedBy: undefined,
    approvedManifest: undefined
  });
}

export function discardScriptDraft(
  projectId: string,
  sectionId: string
): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  if (!project.scriptEditsByNodeId || !(sectionId in project.scriptEditsByNodeId)) {
    return project;
  }
  const nextDrafts = { ...project.scriptEditsByNodeId };
  delete nextDrafts[sectionId];
  const scriptEditsByNodeId = Object.keys(nextDrafts).length > 0 ? nextDrafts : undefined;
  const scriptDraftMeta = buildScriptDraftMeta(scriptEditsByNodeId);
  return updateProject({
    id: projectId,
    scriptEditsByNodeId,
    scriptDraftMeta
  });
}

export function buildOutlineDisabledIds(
  manifest: DraftManifest
): string[] {
  const disabled: string[] = [];
  manifest.sections.forEach((section) => {
    if (!section.selected) {
      disabled.push(section.id);
    }
  });
  return disabled;
}

export function updateDraftSection(
  manifest: DraftManifest,
  sectionId: string,
  patch: Partial<Pick<DraftManifest["sections"][number], "script" | "selected" | "title">>
): DraftManifest {
  const index = manifest.sections.findIndex((section) => section.id === sectionId);
  if (index === -1) {
    return manifest;
  }
  const updatedSection = {
    ...manifest.sections[index],
    ...patch
  };
  const nextSections = [...manifest.sections];
  nextSections[index] = updatedSection;
  return { ...manifest, sections: nextSections };
}

export function isSectionEnabled(
  section: DraftManifest["sections"][number],
  outlineDisabledIds?: string[]
): boolean {
  if (outlineDisabledIds && outlineDisabledIds.includes(section.id)) {
    return false;
  }
  return true;
}

export function getEnabledSections(
  manifest: DraftManifest,
  outlineDisabledIds?: string[]
): DraftManifest["sections"][number][] {
  return manifest.sections.filter((section) => isSectionEnabled(section, outlineDisabledIds));
}

export function getSelectedSectionIds(
  manifest: DraftManifest,
  outlineDisabledIds?: string[]
): string[] {
  return getEnabledSections(manifest, outlineDisabledIds).map((section) => section.id);
}

export function getSelectedSectionCount(
  manifest: DraftManifest,
  outlineDisabledIds?: string[]
): number {
  return getEnabledSections(manifest, outlineDisabledIds).length;
}

export function isSettingsComplete(settings?: GenerationSettings): boolean {
  if (!settings) {
    return false;
  }
  try {
    const { updatedAt: _updatedAt, ...rest } = settings;
    const validation = validateGenerationSettings(rest);
    return validation.ok && Boolean(settings.updatedAt);
  } catch {
    return false;
  }
}

export function setGenerationSettings(
  projectId: string,
  input: Omit<GenerationSettings, "updatedAt">
): CourseVideoProject {
  const validation = validateGenerationSettings(input);
  if (!validation.ok) {
    throw new ValidationError("Generation settings are invalid.", validation.fieldErrors);
  }
  const settings: GenerationSettings = {
    ...input,
    updatedAt: nowIso()
  };
  return updateProject({ id: projectId, generationSettings: settings });
}

function mapJobStateToProjectStatus(status: JobRecord["status"]): ProjectStatus {
  if (status === "succeeded") {
    return "ready";
  }
  if (status === "failed") {
    return "failed";
  }
  return "generating";
}

export function setGenerationJobStatus(
  projectId: string,
  status: JobRecord
): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const timestamp = nowIso();
  const jobRef: GenerationJobRef = {
    jobId: status.id,
    createdAt: project.generationJob?.createdAt ?? timestamp,
    updatedAt: timestamp,
    instanceId: project.generationJob?.instanceId,
    lastStatus: status
  };
  return updateProject({
    id: projectId,
    generationJob: jobRef,
    status: mapJobStateToProjectStatus(status.status)
  });
}

export function canGenerate(
  project: CourseVideoProject
): { ok: true } | { ok: false; reason: "not_approved" | "settings_incomplete" | "missing_manifest" } {
  const approvalStatus =
    project.approvalStatus ??
    (project.approvedManifest ? "approved" : "draft");
  if (approvalStatus !== "approved") {
    return { ok: false, reason: "not_approved" };
  }
  if (!project.approvedManifest) {
    return { ok: false, reason: "missing_manifest" };
  }
  if (!isSettingsComplete(project.generationSettings)) {
    return { ok: false, reason: "settings_incomplete" };
  }
  return { ok: true };
}

export function resetApprovalToDraft(projectId: string): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  return updateProject({
    id: projectId,
    status: "draft",
    approvalStatus: "draft",
    approvedAt: undefined,
    approvedBy: undefined,
    approvedManifest: undefined,
    lastApprovedAt: undefined
  });
}

export function startGenerationJob(
  projectId: string,
  jobId: string,
  initialStatus?: JobRecord,
  instanceId?: string
): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const jobRef: GenerationJobRef = {
    jobId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    instanceId,
    lastStatus: initialStatus
  };
  const historyItem: ProjectGenerationHistoryItem = {
    jobId,
    createdAt: jobRef.createdAt,
    status: initialStatus?.status ?? "queued",
    mp4Path: initialStatus?.artifacts?.mp4Path,
    vttPath: initialStatus?.artifacts?.vttPath,
    srtPath: initialStatus?.artifacts?.srtPath
  };
  return appendGenerationHistory(projectId, historyItem, jobRef);
}

export function updateGenerationJobStatus(
  projectId: string,
  status: JobRecord
): CourseVideoProject {
  const project = setGenerationJobStatus(projectId, status);
  return updateGenerationHistoryItem(
    projectId,
    status.id,
    {
      status: status.status,
      completedAt: status.status === "succeeded" ? status.updatedAt : undefined,
      mp4Path: status.artifacts?.mp4Path,
      vttPath: status.artifacts?.vttPath,
      srtPath: status.artifacts?.srtPath
    },
    project
  );
}

export function appendGenerationHistory(
  projectId: string,
  item: ProjectGenerationHistoryItem,
  jobRef?: GenerationJobRef
): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const history = project.generationHistory ?? [];
  const nextHistory = [item, ...history].slice(0, 5);
  return updateProject({
    id: projectId,
    generationHistory: nextHistory,
    generationJob: jobRef ?? project.generationJob,
    status: jobRef ? "generating" : project.status
  });
}

export function updateGenerationHistoryItem(
  projectId: string,
  jobId: string,
  patch: Partial<ProjectGenerationHistoryItem>,
  projectOverride?: CourseVideoProject
): CourseVideoProject {
  const project = projectOverride ?? getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const history = project.generationHistory ?? [];
  const nextHistory = history.map((item) =>
    item.jobId === jobId ? { ...item, ...patch } : item
  );
  return updateProject({ id: projectId, generationHistory: nextHistory });
}

export function clearCloudOutputs(projectId: string): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const nextStatus =
    (project.approvalStatus === "approved" || project.approvedManifest) &&
    project.status !== "needs_approval"
      ? "approved"
      : "needs_approval";
  return updateProject({
    id: projectId,
    generationHistory: undefined,
    generationJob: undefined,
    status: nextStatus
  });
}

export function clearGenerationJob(projectId: string): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  const nextStatus =
    (project.approvalStatus === "approved" || project.approvedManifest) &&
    project.status !== "needs_approval"
      ? "approved"
      : "needs_approval";
  return updateProject({ id: projectId, generationJob: undefined, status: nextStatus });
}

export function setGenerationJobInstance(
  projectId: string,
  instanceId: string
): CourseVideoProject {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  if (!project.generationJob) {
    return project;
  }
  return updateProject({
    id: projectId,
    generationJob: { ...project.generationJob, instanceId, updatedAt: nowIso() }
  });
}

export async function deleteProjectDocx(projectId: string): Promise<CourseVideoProject> {
  const project = getProject(projectId);
  if (!project) {
    throw new ValidationError("Project not found.");
  }
  await deleteDocx(projectId);
  await deleteTableImagesForProject(projectId);
  const store = readStore() ?? { version: 1, projects: [] };
  const index = store.projects.findIndex((item) => item.id === projectId);
  if (index === -1) {
    throw new ValidationError("Project not found.");
  }
  const current = store.projects[index];
  const next: CourseVideoProject = {
    ...current,
    draftManifest: undefined,
    approvedManifest: undefined,
    lastApprovedAt: undefined,
    approvalStatus: "draft",
    approvedAt: undefined,
    approvedBy: undefined,
    generationJob: undefined,
    generationHistory: undefined,
    sourceDoc: undefined,
    selectedSectionIds: undefined,
    outlineDisabledIds: undefined,
    status: "draft",
    updatedAt: nowIso()
  };
  const updated = [...store.projects];
  updated[index] = next;
  writeStore({ version: 1, projects: updated });
  return next;
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    await deleteDocx(projectId);
    await deleteTableImagesForProject(projectId);
  } catch (err) {
    console.warn("deleteDocx failed", err);
  }
  const store = readStore() ?? { version: 1, projects: [] };
  const nextProjects = store.projects.filter((project) => project.id !== projectId);
  writeStore({ version: 1, projects: nextProjects });
}
