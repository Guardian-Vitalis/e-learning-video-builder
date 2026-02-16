import {
  ApprovedManifest,
  CleanupConfig,
  ScriptCleanupMode,
  GenerationSettings,
  JobArtifacts,
  JobRecord,
  JobSectionProgress,
  StubAvatarStyle,
  StubBackgroundStyle,
  LocalAvatarAdvancedSettings
} from "@evb/shared";
import { jobStoreMemory } from "./jobStoreMemory";
import { getStoreBackend } from "../lib/config";

export type JobInput = {
  manifest: ApprovedManifest;
  projectId: string;
  settings: GenerationSettings;
  targetSectionIds?: string[];
  scriptCleanupMode?: ScriptCleanupMode;
  cleanupConfigOverrides?: Partial<CleanupConfig>;
  stubAvatarStyle?: StubAvatarStyle;
  stubBackgroundStyle?: StubBackgroundStyle;
  localAvatarAdvanced?: LocalAvatarAdvancedSettings;
};

export type JobStore = {
  createJob: (input: JobInput) => Promise<JobRecord>;
  getJobInput: (jobId: string) => Promise<JobInput | null>;
  updateJobInput: (jobId: string, patch: Partial<JobInput>) => Promise<JobInput | null>;
  getJob: (jobId: string) => Promise<JobRecord | null>;
  updateJob: (jobId: string, partial: Partial<JobRecord>) => Promise<JobRecord | null>;
  updateJobSectionProgress: (
    jobId: string,
    sectionId: string,
    patch: Partial<JobSectionProgress>
  ) => Promise<JobRecord | null>;
  setRunning: (jobId: string, progress: JobRecord["progress"]) => Promise<JobRecord | null>;
  setSucceeded: (jobId: string, artifacts: JobArtifacts) => Promise<JobRecord | null>;
  setFailed: (jobId: string, error: JobRecord["error"]) => Promise<JobRecord | null>;
  resetForRetry: (jobId: string) => Promise<JobRecord | null>;
};

let store: JobStore | null = null;

export function getJobStore(): JobStore {
  if (!store) {
    if (getStoreBackend() === "redis") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { jobStoreRedis } = require("./jobStoreRedis");
      store = jobStoreRedis;
    } else {
      store = jobStoreMemory;
    }
  }
  return store;
}
