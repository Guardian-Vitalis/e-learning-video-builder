import { getInstanceId, getQueueBackend, getRunMode, getStoreBackend, isRedisEnabled } from "./config";
import { getHeartbeatKey, getLastHeartbeatSnapshot, WorkerHeartbeatRecord } from "../worker/heartbeat";
export const DEFAULT_HEARTBEAT_MAX_AGE_MS = 5000;

export type WorkerHeartbeatSnapshot = {
  ok: boolean;
  instanceId: string;
  mode: string;
  queue: string;
  store: string;
  provider?: string;
  lastBeatMs: number | null;
  nowMs: number;
};

function getBaseSnapshot(nowMs: number, lastBeatMs: number | null): WorkerHeartbeatSnapshot {
  const ok = lastBeatMs !== null && nowMs - lastBeatMs <= DEFAULT_HEARTBEAT_MAX_AGE_MS;
  return {
    ok,
    instanceId: getInstanceId(),
    mode: getRunMode(),
    queue: getQueueBackend(),
    store: getStoreBackend(),
    lastBeatMs,
    nowMs
  };
}

export async function getWorkerHeartbeatSnapshot(): Promise<WorkerHeartbeatSnapshot> {
  const nowMs = Date.now();
  if (!isRedisEnabled()) {
    const snapshot = getLastHeartbeatSnapshot();
    const lastBeatMs = snapshot?.lastBeatMs ?? null;
    return { ...getBaseSnapshot(nowMs, lastBeatMs), provider: snapshot?.provider };
  }

  try {
    const { getRedis } = await import("../redis/client");
    const raw = await getRedis().get(getHeartbeatKey());
    if (!raw) {
      return getBaseSnapshot(nowMs, null);
    }
    const parsed = JSON.parse(raw) as WorkerHeartbeatRecord;
    const lastBeatMs = Number.isFinite(parsed.lastBeatMs) ? parsed.lastBeatMs : null;
    return {
      ...getBaseSnapshot(nowMs, lastBeatMs),
      provider: parsed.provider
    };
  } catch {
    return getBaseSnapshot(nowMs, null);
  }
}
