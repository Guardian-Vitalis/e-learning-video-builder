import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
let client: IORedis | null = null;

export function getRedis() {
  if (!client) {
    const isTest = process.env.NODE_ENV === "test";
    client = new IORedis(redisUrl, {
      maxRetriesPerRequest: isTest ? 0 : null,
      retryStrategy: isTest ? () => null : undefined,
      lazyConnect: isTest ? true : false,
      enableReadyCheck: isTest ? true : undefined
    });
    client.on("error", (err) => {
      console.error("redis error", err);
    });
  }
  return client;
}
