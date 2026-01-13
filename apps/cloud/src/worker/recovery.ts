import type IORedis from "ioredis";
import { enqueueJob } from "../queue/jobQueue";
import { getJobStore } from "../store/jobStore";
import { getRunningJobsKey } from "../store/jobStoreRedis";
import { appendJobEvent } from "../lib/jobEvents";

const LOCK_TTL_MS = 10000;
const RELEASE_LOCK_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

function leaseKey(instanceId: string, jobId: string) {
  return `evb:${instanceId}:job:${jobId}:lease`;
}

export async function runRecoveryPass(args: {
  redis: IORedis;
  instanceId: string;
  workerId: string;
  config: { maxRetries: number };
}): Promise<{
  scanned: number;
  requeued: number;
  failed: number;
  skipped: number;
  lockAcquired: boolean;
}> {
  const { redis, instanceId, workerId, config } = args;
  const lockKey = `evb:${instanceId}:recovery:lock`;
  const lock = await redis.set(lockKey, workerId, "PX", LOCK_TTL_MS, "NX");
  if (!lock) {
    return { lockAcquired: false, scanned: 0, requeued: 0, failed: 0, skipped: 0 };
  }
  const store = getJobStore();
  let scanned = 0;
  let requeued = 0;
  let failed = 0;
  let skipped = 0;
  try {
    const runningJobs = await redis.smembers(getRunningJobsKey(instanceId));
    for (const jobId of runningJobs) {
      scanned += 1;
      const lease = await redis.get(leaseKey(instanceId, jobId));
      if (lease) {
        skipped += 1;
        continue;
      }
      const job = await store.getJob(jobId);
      if (!job || job.status !== "running") {
        await redis.srem(getRunningJobsKey(instanceId), jobId);
        continue;
      }
      const retryCount = job.retryCount ?? 0;
      if (retryCount < config.maxRetries) {
        await store.resetForRetry(jobId);
        await store.updateJob(jobId, {
          retryCount: retryCount + 1,
          error: { message: "lease_expired_requeued" }
        });
        await enqueueJob(jobId);
        appendJobEvent(redis, instanceId, jobId, "requeued", {
          reason: "lease_missing",
          retryCount: retryCount + 1
        }).catch(() => undefined);
        requeued += 1;
      } else {
        await store.updateJob(jobId, {
          status: "failed",
          progress: { phase: "failed", pct: 0 },
          retryCount,
          error: { message: "stuck_job_max_retries" }
        });
        appendJobEvent(redis, instanceId, jobId, "failed", {
          reason: "stuck_job_max_retries",
          retryCount
        }).catch(() => undefined);
        failed += 1;
      }
    }
    return { lockAcquired: true, scanned, requeued, failed, skipped };
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, workerId);
    } catch {
      // ignore lock cleanup errors
    }
  }
}
