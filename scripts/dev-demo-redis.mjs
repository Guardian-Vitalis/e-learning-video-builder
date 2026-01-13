import { spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const isWin = process.platform === "win32";
const launcherVersion = "NODEONLY-2026-01-01";
const orchestrationVersion = "REDIS-SPLIT-2026-01-01";

console.log(
  `[dev:demo:redis] launcher=v${launcherVersion} platform=${process.platform} node=${process.version}`
);
console.log(`[dev:demo:redis] orchestration=v${orchestrationVersion}`);

if (!process.env.REDIS_URL) {
  console.error("[dev:demo:redis] REDIS_URL is required for redis mode.");
  process.exit(1);
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function pickFreePort(start, end) {
  for (let port = start; port <= end; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(`No free port found in range ${start}-${end}`);
}

async function waitForHealth(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        return res.json();
      }
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Health check timed out after ${timeoutMs}ms`);
}

async function waitForWorkerReady({ baseUrl, timeoutMs }) {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < timeoutMs) {
    attempt += 1;
    let status = "error";
    let body;
    try {
      const res = await fetch(`${baseUrl}/v1/worker/heartbeat`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) {
        body = await res.json();
        status = body.ok ? "ok" : "not-ready";
      } else {
        status = `http-${res.status}`;
      }
    } catch {
      status = "error";
    }
    console.log(`[dev:demo:redis] wait worker attempt=${attempt} status=${status}`);
    if (body?.ok) {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Worker check timed out after ${timeoutMs}ms`);
}

function resolveNextBin(repoRoot) {
  const rootNext = path.resolve(repoRoot, "node_modules", "next", "dist", "bin", "next");
  if (existsSync(rootNext)) {
    return rootNext;
  }
  const localNext = path.resolve(
    repoRoot,
    "apps",
    "local",
    "node_modules",
    "next",
    "dist",
    "bin",
    "next"
  );
  if (existsSync(localNext)) {
    return localNext;
  }
  throw new Error(
    "Unable to resolve Next.js binary. Run yarn install to populate node_modules."
  );
}

function pipe(proc, label) {
  if (proc.stdout) {
    proc.stdout.on("data", (data) => {
      process.stdout.write(`[${label}] ${data}`);
    });
  }
  if (proc.stderr) {
    proc.stderr.on("data", (data) => {
      process.stderr.write(`[${label}] ${data}`);
    });
  }
}

function sanitizeEnv(baseEnv, overrides) {
  const merged = { ...baseEnv, ...overrides };
  const sanitized = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null) {
      continue;
    }
    const stringValue = String(value);
    if (stringValue.includes("\0")) {
      continue;
    }
    sanitized[key] = stringValue;
  }
  return sanitized;
}

function buildBaseEnv() {
  const pick = (key) => {
    if (process.env[key]) {
      return [key, process.env[key]];
    }
    return null;
  };
  if (isWin) {
    const entries = [
      pick("SystemRoot"),
      pick("WINDIR"),
      pick("ComSpec"),
      pick("PATHEXT"),
      pick("Path"),
      pick("PATH"),
      pick("TEMP"),
      pick("TMP"),
      pick("USERPROFILE"),
      pick("HOMEDRIVE"),
      pick("HOMEPATH"),
      pick("HOME"),
      pick("APPDATA"),
      pick("LOCALAPPDATA"),
      pick("NODE_OPTIONS")
    ].filter(Boolean);
    return Object.fromEntries(entries);
  }
  const entries = [
    pick("PATH"),
    pick("HOME"),
    pick("TMPDIR"),
    pick("SHELL"),
    pick("TERM"),
    pick("NODE_OPTIONS")
  ].filter(Boolean);
  return Object.fromEntries(entries);
}

function stripNodeOptions(value) {
  if (!value) {
    return undefined;
  }
  const parts = value.split(" ").filter((part) => {
    return !part.includes("--loader") && !part.includes("ts-node/esm");
  });
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function spawnLogged(label, args, env, cwd, onError) {
  const resolvedCwd = cwd ?? process.cwd();
  const illegal = [process.execPath, ...args].find((value) => {
    const lower = value.toLowerCase();
    return lower.includes("yarn") || lower.endsWith(".cmd");
  });
  if (illegal) {
    throw new Error(
      "Invariant: Node-only launcher must not spawn yarn/yarn.cmd. Check old script wiring."
    );
  }
  console.log(
    `[dev:demo:redis] Starting ${label}: ${process.execPath} ${args.join(" ")} (cwd=${resolvedCwd})`
  );
  console.log(
    `[dev:demo:redis] Env ${label}: PORT=${env.PORT ?? ""} EVB_RUN_MODE=${env.EVB_RUN_MODE ?? ""} EVB_INSTANCE_ID=${env.EVB_INSTANCE_ID ?? ""}`
  );
  const child = spawn(process.execPath, args, {
    env,
    cwd: resolvedCwd,
    stdio: ["ignore", "pipe", "pipe"]
  });
  pipe(child, label);
  child.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? err.code : "unknown";
    console.error(`[dev:demo:redis] Failed to spawn ${label}: ${code} ${message}`);
    console.error(
      `[dev:demo:redis] cmd=${process.execPath} args=${JSON.stringify(args)} cwd=${resolvedCwd}`
    );
    if (onError) {
      onError();
    }
    process.exit(1);
  });
  return child;
}

async function waitForCloudReady({ baseUrl, expectedInstanceId, timeoutMs }) {
  const health = await waitForHealth(`${baseUrl}/v1/health`, timeoutMs);
  const ok =
    health.mode === "split" &&
    health.store === "redis" &&
    health.queue === "redis" &&
    health.redisOk === true &&
    health.instanceId === expectedInstanceId;
  return { ok, health };
}

async function main() {
  const instanceId = `devdemo-redis-${randomUUID()}`;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cloudRoot = path.resolve(repoRoot, "apps", "cloud");
  const cloudApiEntry = path.resolve(cloudRoot, "src", "index.ts");
  const cloudWorkerEntry = path.resolve(cloudRoot, "src", "worker", "index.ts");
  const nextBin = resolveNextBin(repoRoot);
  const localCwd = path.resolve(repoRoot, "apps", "local");

  const baseEnv = sanitizeEnv(buildBaseEnv(), {});
  const commonOverrides = {
    EVB_RUN_MODE: "split",
    EVB_STORE: "redis",
    EVB_QUEUE: "redis",
    EVB_INSTANCE_ID: instanceId,
    NEXT_PUBLIC_EVB_INSTANCE_ID: instanceId,
    REDIS_URL: process.env.REDIS_URL,
    CLOUD_API_BASE_URL: "",
    NEXT_PUBLIC_CLOUD_API_BASE_URL: "",
    TS_NODE_PROJECT: path.join(cloudRoot, "tsconfig.json"),
    TS_NODE_TRANSPILE_ONLY: "1",
    TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: "CommonJS" }),
    NODE_OPTIONS: stripNodeOptions(process.env.NODE_OPTIONS)
  };
  const nodeArgs = ["-r", "ts-node/register/transpile-only"];
  let api;
  let worker;
  let cloudPort;
  let cloudUrl;
  let health;
  let workerHealth;
  let apiStderr = "";
  const cloudCandidates = Array.from({ length: 11 }, (_, i) => 4100 + i);
  let shuttingDown = false;

  for (const candidate of cloudCandidates) {
    cloudPort = candidate;
    cloudUrl = `http://localhost:${cloudPort}`;
    apiStderr = "";
    const apiEnv = sanitizeEnv(baseEnv, {
      ...commonOverrides,
      PORT: String(cloudPort),
      CLOUD_API_BASE_URL: cloudUrl,
      NEXT_PUBLIC_CLOUD_API_BASE_URL: cloudUrl
    });

    api = spawnLogged("cloud-api", [...nodeArgs, cloudApiEntry], apiEnv, cloudRoot);
    if (api.stderr) {
      api.stderr.on("data", (data) => {
        apiStderr += data.toString();
      });
    }

    const exited = new Promise((resolve) => {
      api.on("exit", (code) => resolve(code ?? 0));
    });

    try {
      const result = await Promise.race([
        waitForCloudReady({
          baseUrl: cloudUrl,
          expectedInstanceId: instanceId,
          timeoutMs: 12000
        }),
        exited.then((code) => ({ ok: false, exitCode: code }))
      ]);

      if (result && result.ok) {
        health = result.health;
        break;
      }

      const exitCode = result.exitCode ?? 1;
      const hasAddrInUse =
        apiStderr.includes("EADDRINUSE") || String(exitCode) === "EADDRINUSE";
      api.kill();
      if (hasAddrInUse) {
        continue;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hasAddrInUse = apiStderr.includes("EADDRINUSE");
      api.kill();
      if (hasAddrInUse) {
        continue;
      }
      console.error(`[dev:demo:redis] Cloud API failed to start: ${message}`);
      process.exit(1);
      return;
    }
  }

  if (!api || !health || !cloudUrl || !cloudPort) {
    console.error("[dev:demo:redis] Cloud API failed to start on any port in 4100-4110.");
    process.exit(1);
    return;
  }

  console.log(
    `[dev:demo:redis] /v1/health mode=${health.mode} store=${health.store} queue=${health.queue} redisOk=${health.redisOk} instanceId=${health.instanceId}`
  );

  const workerEnv = sanitizeEnv(baseEnv, {
    ...commonOverrides,
    CLOUD_API_BASE_URL: cloudUrl,
    NEXT_PUBLIC_CLOUD_API_BASE_URL: cloudUrl
  });
  worker = spawnLogged("cloud-worker", [...nodeArgs, cloudWorkerEntry], workerEnv, cloudRoot, () => {
    api.kill();
  });

  try {
    workerHealth = await waitForWorkerReady({ baseUrl: cloudUrl, timeoutMs: 20000 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dev:demo:redis] Worker failed to report ready: ${message}`);
    api.kill();
    worker.kill();
    process.exit(1);
    return;
  }

  if (!workerHealth?.ok) {
    console.error("[dev:demo:redis] Worker health not ok after startup.");
    api.kill();
    worker.kill();
    process.exit(1);
    return;
  }

  console.log(`[dev:demo:redis] Cloud -> ${cloudUrl}`);

  const localPort = await pickFreePort(3001, 3010);
  const localUrl = `http://localhost:${localPort}`;
  const localEnv = sanitizeEnv(baseEnv, {
    ...commonOverrides,
    CLOUD_API_BASE_URL: cloudUrl,
    NEXT_PUBLIC_CLOUD_API_BASE_URL: cloudUrl,
    PORT: String(localPort)
  });
  const local = spawnLogged(
    "local",
    [nextBin, "dev", "-p", String(localPort)],
    localEnv,
    localCwd,
    () => {
      api.kill();
      worker.kill();
    }
  );
  console.log(`[dev:demo:redis] Local -> ${localUrl}`);

  const shutdownAll = (code) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    api.kill();
    worker.kill();
    local.kill();
    process.exit(code ?? 0);
  };

  api.on("exit", (code) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev:demo:redis] Cloud API exited code=${code ?? 0}`);
    shutdownAll(code ?? 1);
  });

  worker.on("exit", (code) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev:demo:redis] Cloud worker exited code=${code ?? 0}`);
    shutdownAll(code ?? 1);
  });

  local.on("exit", (code) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev:demo:redis] Local exited code=${code ?? 0}`);
    shutdownAll(code ?? 1);
  });

  const shutdown = () => shutdownAll(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[dev:demo:redis] Failed to start: ${message}`);
  process.exit(1);
});
