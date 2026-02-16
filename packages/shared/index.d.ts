export declare const SHARED_VERSION: string;

export declare function reflowCaptionText(input: string, maxLen?: number): string;

export type CleanupResult = {
  mode?: "stub" | string;
  seed?: string | null;
  config?: any;
  inputText: string;
  outputText: string;
  cleanedText?: string;
  text?: string;
  warnings?: string[];
  changes?: any[];
};

export declare function cleanupScript(args: {
  text: string;
  seed?: string;
  config?: any;
}): CleanupResult;

export declare const StubAvatarStyle: {
  readonly SIMPLE: "SIMPLE";
  readonly REALISTIC: "REALISTIC";
};
export type StubAvatarStyle = (typeof StubAvatarStyle)[keyof typeof StubAvatarStyle];

export declare const StubBackgroundStyle: {
  readonly PLAIN: "PLAIN";
  readonly GRADIENT: "GRADIENT";
};
export type StubBackgroundStyle = (typeof StubBackgroundStyle)[keyof typeof StubBackgroundStyle];

export declare const ProjectStatus: {
  readonly DRAFT: "DRAFT";
  readonly READY: "READY";
  readonly RUNNING: "RUNNING";
  readonly DONE: "DONE";
  readonly ERROR: "ERROR";
};
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export type ApprovedManifest = any;
export type DraftManifest = any;
export type CourseVideoProject = any;
export type GenerationSettings = any;
export type DraftSection = any;
export type TableImageAttachment = any;
export type DocxMeta = any;

export type JobRecord = any;
export type JobSectionProgress = any;
export type JobArtifacts = any;
export type JobArtifactsManifest = any;

export type HealthResponse = any;

export declare function getAvatarPreset(key?: string): any;
