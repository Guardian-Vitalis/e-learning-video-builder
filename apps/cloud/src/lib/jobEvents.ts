import type IORedis from "ioredis";

export type JobEventType =
  | "accepted"
  | "queued"
  | "lease_acquired"
  | "running"
  | "lease_renew_failed"
  | "requeued"
  | "artifacts_written"
  | "succeeded"
  | "failed";

export type JobEvent = {
  tsMs: number;
  type: JobEventType;
  data?: Record<string, any>;
};

const MAX_EVENTS = 200;
const logFailures = process.env.EVB_LOG_HTTP === "1";

export function jobEventsKey(instanceId: string, jobId: string) {
  return `evb:${instanceId}:job:${jobId}:events`;
}

export async function appendJobEvent(
  redis: IORedis,
  instanceId: string,
  jobId: string,
  type: JobEventType,
  data?: Record<string, any>
) {
  const key = jobEventsKey(instanceId, jobId);
  const event: JobEvent = { tsMs: Date.now(), type, data };
  try {
    await redis.rpush(key, JSON.stringify(event));
    await redis.ltrim(key, -MAX_EVENTS, -1);
  } catch (err) {
    if (logFailures) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[EVB] jobEvents append failed jobId=${jobId} error=${message}`);
    }
  }
}

export async function readJobEvents(
  redis: IORedis,
  instanceId: string,
  jobId: string
): Promise<JobEvent[]> {
  const key = jobEventsKey(instanceId, jobId);
  try {
    const items = await redis.lrange(key, 0, -1);
    return items
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw) as JobEvent;
          if (!parsed || typeof parsed.tsMs !== "number" || !parsed.type) {
            return null;
          }
          return parsed;
        } catch {
          return null;
        }
      })
      .filter((value): value is JobEvent => Boolean(value));
  } catch {
    return [];
  }
}
