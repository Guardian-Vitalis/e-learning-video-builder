export type RunMode = "solo" | "split";
export type Backend = "memory" | "redis";
export type LocalAvatarConfig = {
  baseUrl: string;
  timeoutMs: number;
  token?: string;
};

function normalizeRunMode(value: string | undefined): RunMode | null {
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase();
  if (lower === "solo" || lower === "split") {
    return lower as RunMode;
  }
  return null;
}

export function getRunMode(): RunMode {
  const explicit = normalizeRunMode(process.env.EVB_RUN_MODE);
  if (explicit) {
    return explicit;
  }
  if (process.env.EVB_DEV_NO_REDIS === "1" || process.env.EVB_DEV_NO_REDIS === "true") {
    return "solo";
  }
  if (process.env.EVB_DEV_SOLO === "1" || process.env.EVB_DEV_SOLO === "true") {
    return "solo";
  }
  if (process.env.EVB_STORE === "redis" || process.env.EVB_QUEUE === "redis") {
    return "split";
  }
  return "solo";
}

const startedAt = new Date().toISOString();
const instanceId = process.env.EVB_INSTANCE_ID || "local";

export function getInstanceId() {
  return instanceId;
}

export function getStartedAt() {
  return startedAt;
}

function normalizeBackend(value: string | undefined): Backend | null {
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase();
  if (lower === "memory" || lower === "redis") {
    return lower as Backend;
  }
  return null;
}

function parseEnvNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureRedisUrl(label: string) {
  if (!process.env.REDIS_URL) {
    throw new Error(`REDIS_URL is required when ${label} is set to redis.`);
  }
}

export function getStoreBackend(): Backend {
  const explicit = normalizeBackend(process.env.EVB_STORE);
  const fromMode = getRunMode() === "split" ? "redis" : "memory";
  const selected = explicit ?? fromMode;
  if (getRunMode() === "split" && selected !== "redis") {
    throw new Error("EVB_RUN_MODE=split requires EVB_STORE=redis.");
  }
  if (selected === "redis") {
    ensureRedisUrl("EVB_STORE");
  }
  return selected;
}

export function getQueueBackend(): Backend {
  const explicit = normalizeBackend(process.env.EVB_QUEUE);
  const fromMode = getRunMode() === "split" ? "redis" : "memory";
  const selected = explicit ?? fromMode;
  if (getRunMode() === "split" && selected !== "redis") {
    throw new Error("EVB_RUN_MODE=split requires EVB_QUEUE=redis.");
  }
  if (selected === "redis") {
    ensureRedisUrl("EVB_QUEUE");
  }
  return selected;
}

export function isRedisEnabled() {
  return getStoreBackend() === "redis" || getQueueBackend() === "redis";
}

export function getLocalAvatarConfig(): LocalAvatarConfig {
  const baseUrl =
    process.env.EVB_LOCAL_AVATAR_URL?.trim() || "http://127.0.0.1:5600";
  const timeoutMs = Math.max(
    1000,
    parseEnvNumber(process.env.EVB_LOCAL_AVATAR_TIMEOUT_MS, 120000)
  );
  const token = process.env.EVB_LOCAL_AVATAR_TOKEN?.trim();
  return {
    baseUrl,
    timeoutMs,
    token: token || undefined
  };
}
