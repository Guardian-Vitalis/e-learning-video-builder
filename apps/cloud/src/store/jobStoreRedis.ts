import { randomUUID } from "crypto";
import { JobArtifacts, JobRecord, JobSectionProgress } from "@evb/shared";
import { getRedis } from "../redis/client";
import { getInstanceId } from "../lib/config";
import type { JobInput } from "./jobStore";
import { filterSectionsByTargetIds } from "../lib/targetSections";

export function getJobKeyPrefix(instanceId = getInstanceId()) {
  return `evb:${instanceId}:jobs:`;
}

export function getJobInputKeyPrefix(instanceId = getInstanceId()) {
  return `evb:${instanceId}:jobs:input:`;
}

export function getRunningJobsKey(instanceId = getInstanceId()) {
  return `evb:${instanceId}:jobs:running`;
}

export function getQueuedJobsKey(instanceId = getInstanceId()) {
  return `evb:${instanceId}:jobs:queued`;
}

export function getFailedJobsKey(instanceId = getInstanceId()) {
  return `evb:${instanceId}:jobs:failed`;
}

function jobKey(jobId: string) {
  return `${getJobKeyPrefix()}${jobId}`;
}

function jobInputKey(jobId: string) {
  return `${getJobInputKeyPrefix()}${jobId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function buildInitialStatus(
  jobId: string,
  sections: JobSectionProgress[]
): JobRecord {
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

async function writeJob(job: JobRecord) {
  const redis = getRedis();
  await redis.set(jobKey(job.id), JSON.stringify(job));
}

async function updateStatusIndexes(jobId: string, status: JobRecord["status"]) {
  const redis = getRedis();
  const runningKey = getRunningJobsKey();
  const queuedKey = getQueuedJobsKey();
  const failedKey = getFailedJobsKey();
  if (status === "running") {
    await redis.sadd(runningKey, jobId);
    await redis.srem(queuedKey, failedKey, jobId);
    return;
  }
  if (status === "queued") {
    await redis.sadd(queuedKey, jobId);
    await redis.srem(runningKey, failedKey, jobId);
    return;
  }
  if (status === "failed") {
    await redis.sadd(failedKey, jobId);
    await redis.srem(runningKey, queuedKey, jobId);
    return;
  }
  await redis.srem(runningKey, queuedKey, failedKey, jobId);
}

async function readJob(jobId: string): Promise<JobRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(jobKey(jobId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export const jobStoreRedis = {
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
    await writeJob(status);
    await updateStatusIndexes(jobId, status.status);
    const redis = getRedis();
    await redis.set(jobInputKey(jobId), JSON.stringify(input));
    return status;
  },
  async getJobInput(jobId: string): Promise<JobInput | null> {
    const redis = getRedis();
    const raw = await redis.get(jobInputKey(jobId));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as JobInput;
    } catch {
      return null;
    }
  },
  async updateJobInput(jobId: string, patch: Partial<JobInput>): Promise<JobInput | null> {
    const current = await this.getJobInput(jobId);
    if (!current) {
      return null;
    }
    const next: JobInput = { ...current, ...patch };
    const redis = getRedis();
    await redis.set(jobInputKey(jobId), JSON.stringify(next));
    return next;
  },
  async getJob(jobId: string): Promise<JobRecord | null> {
    return readJob(jobId);
  },
  async updateJob(jobId: string, partial: Partial<JobRecord>): Promise<JobRecord | null> {
    const current = await readJob(jobId);
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
    await writeJob(next);
    await updateStatusIndexes(jobId, next.status);
    return next;
  },
  async updateJobSectionProgress(
    jobId: string,
    sectionId: string,
    patch: Partial<JobSectionProgress>
  ): Promise<JobRecord | null> {
    const current = await readJob(jobId);
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
      progress: { phase: "failed", pct: 100 },
      error
    });
  },
  async resetForRetry(jobId: string): Promise<JobRecord | null> {
    const current = await readJob(jobId);
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
    await writeJob(next);
    await updateStatusIndexes(jobId, next.status);
    return next;
  }
};
