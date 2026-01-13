import { getRedis } from "../redis/client";

const QUEUE_KEY = "evb:queue:jobs";

export async function enqueueJob(jobId: string) {
  const redis = getRedis();
  await redis.lpush(QUEUE_KEY, jobId);
}

export async function dequeueJob(blockSeconds = 30): Promise<string | null> {
  const redis = getRedis();
  const result = await redis.brpop(QUEUE_KEY, blockSeconds);
  if (!result) {
    return null;
  }
  return result[1] ?? null;
}
