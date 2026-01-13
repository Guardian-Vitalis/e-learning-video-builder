import { randomUUID } from "crypto";
import { JobArtifacts, JobRecord, JobSectionProgress } from "@evb/shared";
import type { JobInput, JobStore } from "./jobStore";
import { filterSectionsByTargetIds } from "../lib/targetSections";

function nowIso() {
  return new Date().toISOString();
}

function buildInitialStatus(jobId: string, sections: JobSectionProgress[]): JobRecord {
  const timestamp = nowIso();
  return {
    id: jobId,
    status: "queued",
    progress: { phase: "queued", pct: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
    retryCount: 0,
    sectionsProgress: sections
  };
}

const jobs = new Map<string, JobRecord>();
const inputs = new Map<string, JobInput>();

export function resetJobStoreMemory() {
  jobs.clear();
  inputs.clear();
}

export const jobStoreMemory: JobStore = {
  async createJob(input: JobInput): Promise<JobRecord> {
    const jobId = randomUUID();
    const sections = filterSectionsByTargetIds(
      input.manifest.sections,
      input.targetSectionIds
    );
    const sectionsProgress: JobSectionProgress[] = sections.map((section) => ({
      sectionId: section.id,
      title: section.title,
      status: "queued",
      phase: "queued",
      pct: 0
    }));
    const status = buildInitialStatus(jobId, sectionsProgress);
    jobs.set(jobId, status);
    inputs.set(jobId, input);
    return status;
  },
  async getJobInput(jobId: string): Promise<JobInput | null> {
    return inputs.get(jobId) ?? null;
  },
  async updateJobInput(jobId: string, patch: Partial<JobInput>): Promise<JobInput | null> {
    const current = inputs.get(jobId);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    inputs.set(jobId, next);
    return next;
  },
  async getJob(jobId: string): Promise<JobRecord | null> {
    return jobs.get(jobId) ?? null;
  },
  async updateJob(jobId: string, partial: Partial<JobRecord>): Promise<JobRecord | null> {
    const current = jobs.get(jobId);
    if (!current) {
      return null;
    }
    const next: JobRecord = {
      ...current,
      ...partial,
      progress: partial.progress ?? current.progress,
      status: partial.status ?? current.status,
      retryCount: partial.retryCount ?? current.retryCount,
      artifacts: partial.artifacts ?? current.artifacts,
      error: partial.error ?? current.error,
      sectionsProgress: partial.sectionsProgress ?? current.sectionsProgress,
      inputTableImages: partial.inputTableImages ?? current.inputTableImages,
      updatedAt: nowIso()
    };
    jobs.set(jobId, next);
    return next;
  },
  async updateJobSectionProgress(
    jobId: string,
    sectionId: string,
    patch: Partial<JobSectionProgress>
  ): Promise<JobRecord | null> {
    const current = jobs.get(jobId);
    if (!current || !current.sectionsProgress) {
      return null;
    }
    const nextSections = current.sectionsProgress.map((section) =>
      section.sectionId === sectionId ? { ...section, ...patch } : section
    );
    return this.updateJob(jobId, { sectionsProgress: nextSections });
  },
  async setRunning(jobId: string, progress: JobRecord["progress"]): Promise<JobRecord | null> {
    return this.updateJob(jobId, { status: "running", progress });
  },
  async setSucceeded(jobId: string, artifacts: JobArtifacts): Promise<JobRecord | null> {
    return this.updateJob(jobId, {
      status: "succeeded",
      progress: { phase: "complete", pct: 100 },
      artifacts,
      error: undefined
    });
  },
  async setFailed(jobId: string, error: JobRecord["error"]): Promise<JobRecord | null> {
    return this.updateJob(jobId, {
      status: "failed",
      progress: { phase: "failed", pct: 0 },
      error
    });
  },
  async resetForRetry(jobId: string): Promise<JobRecord | null> {
    const current = jobs.get(jobId);
    if (!current) {
      return null;
    }
    const resetSections = current.sectionsProgress?.map((section) => ({
      ...section,
      status: "queued",
      phase: "queued",
      pct: 0,
      error: undefined
    }));
    const next: JobRecord = {
      ...current,
      status: "queued",
      progress: { phase: "queued", pct: 0 },
      sectionsProgress: resetSections ?? current.sectionsProgress,
      error: undefined,
      updatedAt: nowIso()
    };
    jobs.set(jobId, next);
    return next;
  }
};
