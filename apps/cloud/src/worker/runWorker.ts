import { randomUUID } from "node:crypto";
import { dequeueJobBlocking, enqueueJob } from "../queue/jobQueue";
import { getJobStore } from "../store/jobStore";
import { writeHeartbeat } from "./heartbeat";
import { getAvatarProviderFromEnv } from "../providers/providerFactory";
import { generateStubArtifacts } from "../lib/stubArtifacts";
import { appendJobEvent } from "../lib/jobEvents";
import { runRecoveryPass } from "./recovery";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getInstanceId, getQueueBackend, getRunMode, getStoreBackend, isRedisEnabled } from "../lib/config";
import { filterSectionsByTargetIds } from "../lib/targetSections";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEnvNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function computeOverallPct(sections: Array<{ pct: number }>) {
  if (sections.length === 0) {
    return 0;
  }
  const total = sections.reduce((sum, section) => sum + section.pct, 0);
  return Math.round(total / sections.length);
}

async function deleteJobInputs(jobId: string) {
  const inputsDir = path.resolve(process.cwd(), "data", "jobs", jobId, "inputs");
  try {
    await fs.rm(inputsDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function runJob(
  jobId: string,
  providerName: string,
  generateClips: ReturnType<typeof getAvatarProviderFromEnv>["generateClips"],
  options: { timeoutMs: number; shouldContinue?: () => boolean }
) {
  const store = getJobStore();
  const instanceId = getInstanceId();
  const logEvent = async (type: Parameters<typeof appendJobEvent>[3], data?: Record<string, any>) => {
    if (!isRedisEnabled()) {
      return;
    }
    try {
      const { getRedis } = await import("../redis/client");
      await appendJobEvent(getRedis(), instanceId, jobId, type, data);
    } catch {
      // ignore event failures
    }
  };
  let currentSectionId: string | null = null;
  const shouldContinue = options.shouldContinue;
  try {
    if (shouldContinue && !shouldContinue()) {
      return;
    }
    const existing = await store.getJob(jobId);
    if (!existing) {
      return;
    }

    const input = await store.getJobInput(jobId);
    if (!input) {
      await store.setFailed(jobId, {
        message: "Worker failure",
        details: "Missing job input for provider execution."
      });
      await logEvent("failed", { error: "Missing job input for provider execution." });
      return;
    }
    // Partial regen overwrites only targeted clip assets; non-targeted assets remain untouched.
    // Full recomposition (video concatenation) is intentionally unchanged in this loop.
    const renderSections = filterSectionsByTargetIds(
      input.manifest.sections,
      input.targetSectionIds
    );
    if (input.targetSectionIds && input.targetSectionIds.length > 0 && renderSections.length === 0) {
      await store.setFailed(jobId, {
        message: "Worker failure",
        details: "Target sections did not match the approved manifest."
      });
      await logEvent("failed", { error: "Target sections invalid." });
      return;
    }
    const renderManifest =
      renderSections.length > 0 ? { ...input.manifest, sections: renderSections } : input.manifest;

    try {
      if (shouldContinue && !shouldContinue()) {
        return;
      }
      await withTimeout(
        generateClips({
          jobId,
          approvedManifest: renderManifest,
          settings: input.settings
        }),
        options.timeoutMs,
        "Provider generation"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.setFailed(jobId, {
        message: `Provider (${providerName}) failed to generate clips`,
        details: message
      });
      await logEvent("failed", {
        error: `Provider (${providerName}) failed to generate clips`,
        detail: message.slice(0, 200)
      });
      return;
    }

    if (shouldContinue && !shouldContinue()) {
      return;
    }
    await store.setRunning(jobId, { phase: "running", pct: 0 });
    if (shouldContinue && shouldContinue()) {
      await logEvent("running", { workerId: `${getInstanceId()}:${process.pid}` });
    }
    const sections = (existing.sectionsProgress ??
      renderManifest.sections.map((section) => ({
        sectionId: section.id,
        title: section.title,
        status: "queued" as const,
        phase: "queued",
        pct: 0
      }))).map((section) => ({ ...section }));

    const updateSection = async (
      sectionId: string,
      patch: { status?: string; phase?: string; pct?: number; error?: { message: string; details?: string } }
    ) => {
      const index = sections.findIndex((section) => section.sectionId === sectionId);
      if (index === -1) {
        return;
      }
      sections[index] = { ...sections[index], ...patch };
      await store.updateJobSectionProgress(jobId, sectionId, patch);
      const overallPct = computeOverallPct(sections);
      await store.setRunning(jobId, { phase: "running", pct: overallPct });
    };

    const perSectionSteps = [0, 25, 50, 70];

    for (const section of renderManifest.sections) {
      if (shouldContinue && !shouldContinue()) {
        return;
      }
      currentSectionId = section.id;
      await updateSection(section.id, {
        status: "running",
        phase: "clips",
        pct: 0
      });

      for (const pct of perSectionSteps.slice(1)) {
        await sleep(4000);
        await updateSection(section.id, {
          status: "running",
          phase: "clips",
          pct
        });
      }

      await sleep(2000);
      await updateSection(section.id, {
        status: "succeeded",
        phase: "done",
        pct: 100
      });
    }

    let sectionImages: Record<string, string> | undefined;
    if (
      input.settings.outputMode === "avatar_plus_slides" &&
      existing.inputTableImages &&
      existing.inputTableImages.length > 0
    ) {
      sectionImages = {};
      for (const image of existing.inputTableImages) {
        if (!sectionImages[image.sectionId]) {
          sectionImages[image.sectionId] = image.relPath;
        }
      }
    }

    if (shouldContinue && !shouldContinue()) {
      return;
    }
    const artifacts = await withTimeout(
      generateStubArtifacts({
        jobId,
        manifest: input.manifest,
        settings: input.settings,
        sectionImages,
        scriptCleanupMode: input.scriptCleanupMode,
        cleanupConfigOverrides: input.cleanupConfigOverrides,
        stubAvatarStyle: input.stubAvatarStyle,
        stubBackgroundStyle: input.stubBackgroundStyle,
        localAvatarAdvanced: input.localAvatarAdvanced,
        avatarProvider: providerName,
        targetSectionIds: input.targetSectionIds
      }),
      options.timeoutMs,
      "Stub artifact generation"
    );
    if (shouldContinue && shouldContinue()) {
      await logEvent("artifacts_written", {
        files: ["video.mp4", "captions.vtt", "captions.srt"]
      });
    }
    console.log(
      `[EVB] artifacts written jobId=${jobId} files=video.mp4,captions.vtt,captions.srt`
    );
    if (shouldContinue && !shouldContinue()) {
      return;
    }
    await store.setSucceeded(jobId, artifacts);
    if (shouldContinue && shouldContinue()) {
      await logEvent("succeeded");
    }
    console.log(`[EVB] job succeeded jobId=${jobId}`);
  } catch (err) {
    if (shouldContinue && !shouldContinue()) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (currentSectionId) {
      await store.updateJobSectionProgress(jobId, currentSectionId, {
        status: "failed",
        phase: "failed",
        error: { message }
      });
    }
    await store.setFailed(jobId, {
      message,
      details: message
    });
    await logEvent("failed", { error: message.slice(0, 200) });
    console.log(`[EVB] job failed jobId=${jobId} error=${message}`);
    await deleteJobInputs(jobId);
    return;
  }

  await deleteJobInputs(jobId);
}

export async function startWorker(options?: { signal?: AbortSignal; jobTimeoutMs?: number }) {
  let running = true;
  let backoffMs = 1000;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let recoveryTimer: ReturnType<typeof setInterval> | null = null;
  const runMode = getRunMode();
  const instanceId = getInstanceId();
  const storeBackend = getStoreBackend();
  const queueBackend = getQueueBackend();
  const provider = getAvatarProviderFromEnv(process.env, runMode);
  const timeoutMs = options?.jobTimeoutMs ?? 120000;
  const dequeueTimeout = options?.signal ? 2 : 30;
  const useRedis = isRedisEnabled();
  const workerId = `${instanceId}:${process.pid}:${randomUUID()}`;
  const leaseTtlMs = Math.max(5000, parseEnvNumber(process.env.EVB_JOB_LEASE_MS, 60000));
  const leaseRenewMs = Math.max(1000, parseEnvNumber(process.env.EVB_JOB_LEASE_RENEW_MS, 20000));
  const recoveryScanMs = Math.max(
    1000,
    parseEnvNumber(process.env.EVB_JOB_RECOVERY_SCAN_MS, 30000)
  );
  const maxRetries = Math.max(0, parseEnvNumber(process.env.EVB_JOB_MAX_RETRIES, 3));
  const crashAfterRunning = process.env.EVB_TEST_CRASH_AFTER_RUNNING === "1";

  const shutdown = async () => {
    running = false;
    try {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (recoveryTimer) {
        clearInterval(recoveryTimer);
        recoveryTimer = null;
      }
      if (useRedis) {
        const { getRedis } = await import("../redis/client");
        await getRedis().quit();
      }
    } catch {
      // ignore shutdown errors
    }
  };

  process.on("SIGINT", () => {
    console.log("worker shutting down");
    shutdown().catch(() => undefined);
  });
  process.on("SIGTERM", () => {
    console.log("worker shutting down");
    shutdown().catch(() => undefined);
  });
  if (options?.signal) {
    options.signal.addEventListener("abort", () => {
      shutdown().catch(() => undefined);
    });
  }

  console.log(`worker listening for jobs (mode=${runMode} provider=${provider.name})`);
  const store = getJobStore();

  const leaseKey = (jobId: string) => `evb:${instanceId}:job:${jobId}:lease`;
  const renewScript = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) else return 0 end`;
  const releaseScript = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

  if (useRedis) {
    const { getRedis } = await import("../redis/client");
    const redis = getRedis();
    runRecoveryPass({
      redis,
      instanceId,
      workerId,
      config: { maxRetries }
    }).catch(() => undefined);
    recoveryTimer = setInterval(() => {
      runRecoveryPass({
        redis,
        instanceId,
        workerId,
        config: { maxRetries }
      }).catch(() => undefined);
    }, recoveryScanMs);
  }
  heartbeatTimer = setInterval(async () => {
    try {
      const nowMs = Date.now();
      const record = {
        ok: true,
        instanceId,
        mode: runMode,
        queue: queueBackend,
        store: storeBackend,
        provider: provider.name,
        lastBeatMs: nowMs,
        nowMs
      };
      if (!useRedis) {
        await writeHeartbeat(record);
      } else {
        const { getRedis } = await import("../redis/client");
        await writeHeartbeat(record, getRedis());
      }
    } catch {
      // ignore heartbeat failures
    }
  }, 2000);

  while (running) {
    try {
      const jobId = await dequeueJobBlocking(dequeueTimeout);
      if (!jobId) {
        backoffMs = 1000;
        continue;
      }
      console.log(`[EVB] job picked jobId=${jobId} mode=${runMode} provider=${provider.name}`);
      let leaseLost = false;
      let leaseTimer: ReturnType<typeof setInterval> | null = null;
      const shouldContinue = () => !leaseLost;
      if (useRedis) {
        const { getRedis } = await import("../redis/client");
        const redis = getRedis();
        const acquired = await redis.set(leaseKey(jobId), workerId, "PX", leaseTtlMs, "NX");
        if (!acquired) {
          await enqueueJob(jobId);
          backoffMs = 1000;
          continue;
        }
        appendJobEvent(redis, instanceId, jobId, "lease_acquired", {
          workerId,
          ttlMs: leaseTtlMs
        }).catch(() => undefined);
        leaseTimer = setInterval(async () => {
          try {
            const result = await redis.eval(renewScript, 1, leaseKey(jobId), workerId, leaseTtlMs);
            if (!result) {
              appendJobEvent(redis, instanceId, jobId, "lease_renew_failed", {
                workerId
              }).catch(() => undefined);
              leaseLost = true;
              if (leaseTimer) {
                clearInterval(leaseTimer);
                leaseTimer = null;
              }
            }
          } catch {
            appendJobEvent(redis, instanceId, jobId, "lease_renew_failed", {
              workerId
            }).catch(() => undefined);
            leaseLost = true;
            if (leaseTimer) {
              clearInterval(leaseTimer);
              leaseTimer = null;
            }
          }
        }, leaseRenewMs);
      }

      if (crashAfterRunning && useRedis) {
        await store.setRunning(jobId, { phase: "running", pct: 0 });
        const { getRedis } = await import("../redis/client");
        appendJobEvent(getRedis(), instanceId, jobId, "failed", {
          reason: "crash_after_running"
        }).catch(() => undefined);
        console.warn("[EVB] test crash after running triggered");
        if (leaseTimer) {
          clearInterval(leaseTimer);
          leaseTimer = null;
        }
        await shutdown();
        return;
      }

      try {
        await runJob(jobId, provider.name, provider.generateClips, {
          timeoutMs,
          shouldContinue
        });
      } finally {
        if (useRedis && leaseTimer) {
          clearInterval(leaseTimer);
          leaseTimer = null;
          if (!leaseLost) {
            try {
              const { getRedis } = await import("../redis/client");
              await getRedis().eval(releaseScript, 1, leaseKey(jobId), workerId);
            } catch {
              // ignore release errors
            }
          }
        }
      }
      backoffMs = 1000;
    } catch (err) {
      console.error("worker error", err);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 10000);
    }
  }
}
