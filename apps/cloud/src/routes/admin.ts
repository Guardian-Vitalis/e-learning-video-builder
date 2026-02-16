import { Router } from "express";
import { getJobStore } from "../store/jobStore";
import { getQueueBackend, getStoreBackend, isRedisEnabled, getInstanceId } from "../lib/config";
import { getFailedJobsKey, getQueuedJobsKey, getRunningJobsKey } from "../store/jobStoreRedis";
import { readJobEvents } from "../lib/jobEvents";
import { runRecoveryPass } from "../worker/recovery";

const router = Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function ensureRedisMode() {
  if (!isRedisEnabled()) {
    return false;
  }
  return getStoreBackend() === "redis" && getQueueBackend() === "redis";
}

function parseLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

router.get("/admin/jobs", async (req, res) => {
  try {
    if (!ensureRedisMode()) {
      return res.status(400).json({ error: "admin_requires_redis_mode" });
    }
  } catch {
    return res.status(400).json({ error: "admin_requires_redis_mode" });
  }
  const status =
    req.query.status === "queued" || req.query.status === "failed" || req.query.status === "running"
      ? req.query.status
      : "running";
  const limit = parseLimit(req.query.limit);
  const instanceId = getInstanceId();
  const jobStore = getJobStore();
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  const key =
    status === "queued"
      ? getQueuedJobsKey(instanceId)
      : status === "failed"
        ? getFailedJobsKey(instanceId)
        : getRunningJobsKey(instanceId);
  let cursor = "0";
  const ids: string[] = [];
  const count = Math.min(200, limit);
  while (ids.length < limit) {
    const result = await redis.sscan(key, cursor, "COUNT", count);
    cursor = result[0];
    ids.push(...result[1]);
    if (cursor === "0") {
      break;
    }
  }
  const jobs = await Promise.all(
    ids.map(async (jobId) => {
      const job = await jobStore.getJob(jobId);
      if (!job) {
        return null;
      }
      const leaseKey = `evb:${instanceId}:job:${jobId}:lease`;
      const [owner, ttlMs] = await Promise.all([redis.get(leaseKey), redis.pttl(leaseKey)]);
      const leaseTtlMs = ttlMs >= 0 ? ttlMs : null;
      const leaseOk = Boolean(owner) && typeof leaseTtlMs === "number" && leaseTtlMs > 0;
      return {
        jobId,
        status: job.status,
        updatedAt: job.updatedAt,
        retryCount: job.retryCount ?? 0,
        lastError: job.error?.message ?? null,
        leaseOk,
        leaseOwner: owner ?? null,
        leaseTtlMs
      };
    })
  );
  return res.json({ items: jobs.filter(Boolean) });
});

router.get("/admin/jobs/:id", async (req, res) => {
  try {
    if (!ensureRedisMode()) {
      return res.status(400).json({ error: "admin_requires_redis_mode" });
    }
  } catch {
    return res.status(400).json({ error: "admin_requires_redis_mode" });
  }
  const jobStore = getJobStore();
  const job = await jobStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "not_found" });
  }
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  const instanceId = getInstanceId();
  const leaseKey = `evb:${instanceId}:job:${req.params.id}:lease`;
  const [owner, ttlMs] = await Promise.all([redis.get(leaseKey), redis.pttl(leaseKey)]);
  const leaseTtlMs = ttlMs >= 0 ? ttlMs : null;
  const leaseOk = Boolean(owner) && typeof leaseTtlMs === "number" && leaseTtlMs > 0;
  return res.json({
    ...job,
    leaseOk,
    leaseOwner: owner ?? null,
    leaseTtlMs
  });
});

router.get("/admin/jobs/:id/events", async (req, res) => {
  try {
    if (!ensureRedisMode()) {
      return res.status(400).json({ error: "admin_requires_redis_mode" });
    }
  } catch {
    return res.status(400).json({ error: "admin_requires_redis_mode" });
  }
  const jobStore = getJobStore();
  const job = await jobStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "not_found" });
  }
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  const events = await readJobEvents(redis, getInstanceId(), req.params.id);
  return res.json({ jobId: req.params.id, events });
});

router.post("/admin/recover", async (_req, res) => {
  try {
    if (!ensureRedisMode()) {
      return res.status(400).json({ error: "admin_requires_redis_mode" });
    }
  } catch {
    return res.status(400).json({ error: "admin_requires_redis_mode" });
  }
  const instanceId = getInstanceId();
  const workerId = `${instanceId}:admin:${Date.now()}`;
  const maxRetries = Math.max(0, Number(process.env.EVB_JOB_MAX_RETRIES ?? "3"));
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  const result = await runRecoveryPass({
    redis,
    instanceId,
    workerId,
    config: { maxRetries }
  });
  if (!result.lockAcquired) {
    return res.status(409).json({ error: "recovery_lock_held" });
  }
  return res.json(result);
});

export { router as adminRouter };
