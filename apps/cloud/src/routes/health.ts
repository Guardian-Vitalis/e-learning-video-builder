import { Router } from "express";
import { getDevModeLabel } from "../lib/devFlags";
import {
  getInstanceId,
  getLocalAvatarConfig,
  getQueueBackend,
  getStartedAt,
  getStoreBackend,
  isRedisEnabled
} from "../lib/config";
import { getWorkerHeartbeatSnapshot } from "../lib/workerHealth";

const router = Router();

async function pingRedis(timeoutMs = 500) {
  const { getRedis } = await import("../redis/client");
  const redis = getRedis();
  const timeout = new Promise<false>((resolve) => {
    setTimeout(() => resolve(false), timeoutMs);
  });
  const ping = redis
    .ping()
    .then(() => true)
    .catch(() => false);
  return Promise.race([ping, timeout]);
}

function sanitizeDetails(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetails(item));
  }
  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    const normalized = key.toLowerCase();
    if (normalized.includes("token") || normalized.includes("authorization") || normalized.includes("apikey")) {
      continue;
    }
    sanitized[key] = sanitizeDetails(item);
  }
  return sanitized;
}

async function fetchLocalAvatarHealthDetails() {
  const rawUrl = process.env.EVB_LOCAL_AVATAR_URL?.trim();
  if (!rawUrl) {
    return { enabled: false, reason: "EVB_LOCAL_AVATAR_URL not set" };
  }
  const config = getLocalAvatarConfig();
  const headers: Record<string, string> = {};
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs));
  try {
    const url = `${rawUrl.replace(/\/$/, "")}/health/details`;
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      return { enabled: true, reachable: false, error: `HTTP ${res.status}` };
    }
    let details: unknown = {};
    try {
      details = text ? JSON.parse(text) : {};
    } catch {
      return { enabled: true, reachable: false, error: "Invalid JSON response" };
    }
    return {
      enabled: true,
      reachable: true,
      fetchedAt: new Date().toISOString(),
      details: sanitizeDetails(details)
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return { enabled: true, reachable: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/health", async (_req, res) => {
  const redisOk = isRedisEnabled() ? await pingRedis() : null;
  const version = process.env.APP_VERSION ?? "dev";
  const workerSnapshot = await getWorkerHeartbeatSnapshot();
  res.json({
    ok: true,
    redisOk,
    mode: getDevModeLabel(),
    store: getStoreBackend(),
    queue: getQueueBackend(),
    version,
    instanceId: getInstanceId(),
    startedAt: getStartedAt(),
    worker: {
      ok: workerSnapshot.ok,
      lastBeatMs: workerSnapshot.lastBeatMs
    }
  });
});

router.get("/health/local-avatar/details", async (_req, res) => {
  const payload = await fetchLocalAvatarHealthDetails();
  res.json(payload);
});

export { router as healthRouter };
