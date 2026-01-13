export type HealthResponse = {
  status: "ok" | string;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type ApprovalStatus = "draft" | "approved";

export type ProjectStatus =
  | "draft"
  | "needs_approval"
  | "approved"
  | "generating"
  | "ready"
  | "failed";

export interface ApprovedSection {
  id: string;
  title: string;
  script: string;
}

export interface ApprovedManifest {
  manifestVersion: "0.1";
  courseTitle: string;
  approvedAt: string;
  draftSignature: string;
  sections: ApprovedSection[];
  settings?: GenerationSettings;
  cleanupMode?: ScriptCleanupMode;
  localAvatar?: LocalAvatarManifestBlock;
}

export interface JobProgress {
  phase: string;
  pct: number;
}

export interface JobArtifacts {
  mp4Path: string;
  vttPath: string;
  srtPath: string;
  expiresAt: string;
  manifestPath?: string;
}

export interface JobError {
  message: string;
  details?: string;
}

export type JobSectionProgress = {
  sectionId: string;
  title: string;
  status: JobStatus;
  phase: string;
  pct: number;
  error?: JobError;
};

export interface JobRecord {
  id: string;
  status: JobStatus;
  progress: JobProgress;
  createdAt: string;
  updatedAt: string;
  retryCount?: number;
  artifacts?: JobArtifacts;
  error?: JobError;
  sectionsProgress?: JobSectionProgress[];
  inputTableImages?: Array<{
    id: string;
    sectionId: string;
    anchorText: string;
    relPath: string;
    mimeType: string;
  }>;
}

export interface GenerationJobRef {
  jobId: string;
  createdAt: string;
  updatedAt: string;
  instanceId?: string;
  lastStatus?: JobRecord;
}

export type ProjectGenerationHistoryItem = {
  jobId: string;
  createdAt: string;
  completedAt?: string;
  status: JobStatus;
  mp4Path?: string;
  vttPath?: string;
  srtPath?: string;
};

export interface ScriptDraftMeta {
  updatedAt: string;
  dirtyNodeIds?: string[];
}

export interface CourseVideoProject {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  approvalStatus?: ApprovalStatus;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
  lastApprovedAt?: string;
  approvedScriptHashByNodeId?: Record<string, string>;
  approvedSentenceHashesByNodeId?: Record<string, string[]>;
  approvedScriptHashAlgo?: "sha256";
  generationSettings?: GenerationSettings;
  localAvatarAdvanced?: LocalAvatarAdvancedSettings;
  localAvatar?: LocalAvatarPreparedState;
  clipPlanner?: ClipPlannerSettings;
  projectSettingsOverrides?: ProjectSettingsOverrides;
  scriptCleanupMode?: ScriptCleanupMode;
  cleanupConfigOverrides?: Partial<CleanupConfig>;
  generationJob?: GenerationJobRef;
  generationHistory?: ProjectGenerationHistoryItem[];
  draftManifest?: DraftManifest;
  approvedManifest?: ApprovedManifest;
  sourceDoc?: DocxSourceDoc;
  selectedSectionIds?: string[];
  outlineDisabledIds?: string[];
  scriptEditsByNodeId?: Record<string, string>;
  scriptDraftMeta?: ScriptDraftMeta;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
}

export type OutputMode = "avatar_only" | "avatar_plus_slides";

export type StubAvatarStyle = "silhouette" | "illustration" | "photo" | "badge";
export type StubBackgroundStyle = "neutral" | "gradient" | "classroom";

export type RenderProfile = {
  width: number;
  height: number;
  fps: number;
  codec: "h264" | "mpeg4";
  pixelFormat: "yuv420p";
};

export type ScriptCleanupMode = "off" | "deterministic" | "llm";
export type CleanupMode = ScriptCleanupMode;

export type CleanupConfig = {
  expandAbbreviations?: boolean;
  abbreviations?: Record<string, string>;
  maxWordsPerSentence?: number;
  maxLineChars?: number;
  addPauses?: boolean;
  synonymSubstitutions?: boolean;
  substitutionRate?: number;
};

export type CleanupResult = {
  cleanedText: string;
  warnings: string[];
  stats: { originalChars: number; cleanedChars: number; sentenceCount: number };
};

export interface GenerationSettings {
  outputMode: OutputMode;
  avatarPresetId: string;
  voicePresetId: string;
  stylePresetId: string;
  sentencesPerClip: number;
  variationsPerSection: number;
  updatedAt: string;
}

export type LocalAvatarAdvancedSettings = {
  avatarId?: string;
  fps?: number;
  bboxShift?: number;
};

export type LocalAvatarPreparedState = {
  avatarId: string;
  fps: number;
  bboxShift: number;
  prepKey?: string;
  lastPreparedAt?: string;
  lastCacheHit?: boolean;
  refImageDataUrl?: string | null;
};

export type ClipPlannerAvatarMode = "none" | "prepared";

export interface ClipPlannerPreparedAvatar {
  avatarId: string;
  fps: number;
  bboxShift: number;
  refImageDataUrl?: string | null;
}

export interface ClipPlannerSettings {
  avatarMode: ClipPlannerAvatarMode;
  preparedAvatar?: ClipPlannerPreparedAvatar;
}

export type LocalAvatarManifestBlock = {
  kind: "prepared";
  avatarId: string;
  fps: number;
  bboxShift: number;
};

export type ArtifactClip = {
  id: string;
  text: string;
  mp4Path: string;
  vttPath: string;
  srtPath: string;
  durationMs: number;
  sectionId: string;
  variationIndex: number;
  clipIndex: number;
  render?: {
    avatarStyle: StubAvatarStyle;
    backgroundStyle: StubBackgroundStyle;
    profile: RenderProfile;
  };
};

export type ArtifactSectionVariation = {
  variationIndex: number;
  text: string;
  sourceText?: string;
  cleanedNarrationText?: string;
  cleanupMode?: ScriptCleanupMode;
  cleanupWarnings?: string[];
  clips: ArtifactClip[];
};

export type ArtifactSectionManifest = {
  sectionId: string;
  title?: string;
  sourceText: string;
  cleanedNarrationText?: string;
  cleanupMode?: ScriptCleanupMode;
  cleanupWarnings?: string[];
  variations: ArtifactSectionVariation[];
};

export type JobArtifactsManifest = {
  version: 1;
  jobId: string;
  mode: string;
  provider: string;
  cleanupMode?: ScriptCleanupMode;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
  renderProfile?: RenderProfile;
  settings: { sentencesPerClip: number; variationsPerSection: number };
  sections: ArtifactSectionManifest[];
  primary: { mp4Path: string; vttPath: string; srtPath: string; durationMs: number };
};

export interface DocxMeta {
  fileName: string;
  fileSize: number;
  lastModified: number;
  storedAt: string;
}

export type TableImageAttachment = {
  id: string;
  sectionId: string;
  tableIndex: number;
  rowIndex: number;
  cellIndex: number;
  anchorText: string;
  relId: string;
  fileName: string;
  mimeType: string;
};

export interface DraftSection {
  id: string;
  title: string;
  level: number;
  selected: boolean;
  script: string;
  mediaRefs: string[];
  tableImages?: TableImageAttachment[];
}

export interface DraftManifest {
  manifestVersion: "0.1";
  courseTitle: string;
  doc: DocxMeta;
  sections: DraftSection[];
  localAvatar?: LocalAvatarManifestBlock;
}

export type DocxImportSection = {
  sectionId: string;
  level: 1 | 2 | 3;
  heading: string;
  text: string;
};

export type DocxSourceDoc = {
  title?: string;
  sections: DocxImportSection[];
};

export type ProjectSettingsOverrides = {
  sentencesPerClip: number;
  variationsPerSection: number;
};

export type DocxImportRequest = {
  filename: string;
  dataBase64: string;
};

export type DocxImportResponse = {
  title?: string;
  sections: DocxImportSection[];
};

export type JobInputTableImage = {
  id: string;
  sectionId: string;
  fileName: string;
  mimeType: string;
  anchorText: string;
  base64: string;
};

export type CreateJobRequest = {
  projectId: string;
  manifest?: ApprovedManifest;
  sourceDoc?: DocxSourceDoc;
  selectedSectionIds?: string[];
  targetSectionIds?: string[];
  scriptCleanupMode?: ScriptCleanupMode;
  cleanupConfigOverrides?: Partial<CleanupConfig>;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
  localAvatarAdvanced?: LocalAvatarAdvancedSettings;
  settings: GenerationSettings;
  tableImages?: JobInputTableImage[];
};

export type CreateJobResponse = {
  jobId: string;
  status: JobRecord;
};

export type RetryJobResponse = {
  jobId: string;
};
