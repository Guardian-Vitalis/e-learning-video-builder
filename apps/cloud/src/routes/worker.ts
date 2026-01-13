import { Router } from "express";
import { getWorkerHeartbeatSnapshot } from "../lib/workerHealth";

const router = Router();
const MAX_AGE_SECONDS = 5;

export function isHeartbeatFresh(lastBeatMs: number | null, nowMs: number, maxAgeSeconds = MAX_AGE_SECONDS) {
  if (!lastBeatMs || Number.isNaN(lastBeatMs)) {
    return { ok: false, ageSeconds: null };
  }
  const ageSeconds = Math.max(0, Math.floor((nowMs - lastBeatMs) / 1000));
  return { ok: ageSeconds <= maxAgeSeconds, ageSeconds };
}

router.get("/worker/heartbeat", async (_req, res) => {
  const snapshot = await getWorkerHeartbeatSnapshot();
  const status = snapshot.ok ? 200 : 503;
  return res.status(status).json({
    ok: snapshot.ok,
    error: snapshot.ok ? undefined : "worker_down",
    instanceId: snapshot.instanceId,
    mode: snapshot.mode,
    queue: snapshot.queue,
    store: snapshot.store,
    provider: snapshot.provider,
    lastBeatMs: snapshot.lastBeatMs,
    nowMs: snapshot.nowMs
  });
});

router.head("/worker/heartbeat", async (_req, res) => {
  const snapshot = await getWorkerHeartbeatSnapshot();
  return res.sendStatus(snapshot.ok ? 200 : 503);
});

export { router as workerRouter };
