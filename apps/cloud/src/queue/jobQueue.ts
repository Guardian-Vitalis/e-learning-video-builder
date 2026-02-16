import { getInstanceId, getQueueBackend } from "../lib/config";
import {
  enqueueJob as enqueueMemory,
  dequeueJobBlocking as dequeueMemory
} from "./jobQueueMemory";

const queueKey = () => `evb:${getInstanceId()}:queue:jobs`;

export async function enqueueJob(jobId: string) {
  if (getQueueBackend() !== "redis") {
    await enqueueMemory(jobId);
    return;
  }
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  await redis.rpush(queueKey(), jobId);
}

export async function dequeueJobBlocking(timeoutSeconds = 30): Promise<string | null> {
  if (getQueueBackend() !== "redis") {
    return dequeueMemory(timeoutSeconds);
  }
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  const result = await redis.blpop(queueKey(), timeoutSeconds);
  if (!result) {
    return null;
  }
  return result[1] ?? null;
}
