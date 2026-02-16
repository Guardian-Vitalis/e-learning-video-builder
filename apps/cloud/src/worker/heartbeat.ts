import type IORedis from "ioredis";
import { getInstanceId } from "../lib/config";

const HEARTBEAT_TTL_SECONDS = 60;

export type WorkerHeartbeatRecord = {
  ok: boolean;
  instanceId: string;
  mode: string;
  queue: string;
  store: string;
  provider: string;
  lastBeatMs: number;
  nowMs: number;
};

let lastSnapshot: WorkerHeartbeatRecord | null = null;

export function getLastHeartbeatSnapshot() {
  return lastSnapshot;
}

export function getHeartbeatKey(instanceId = getInstanceId()) {
  return `evb:${instanceId}:worker:heartbeat`;
}

export async function writeHeartbeat(record: WorkerHeartbeatRecord, redis?: IORedis) {
  lastSnapshot = record;
  if (!redis) {
    return;
  }
  await redis.set(getHeartbeatKey(record.instanceId), JSON.stringify(record), "EX", HEARTBEAT_TTL_SECONDS);
}
