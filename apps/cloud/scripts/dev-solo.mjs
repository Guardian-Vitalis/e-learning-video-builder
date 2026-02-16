import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const isWin = process.platform === "win32";
const launcherVersion = "TSNODE-CJS-2026-01-01";
console.log(`[cloud] launcher=v${launcherVersion} node=${process.version}`);

function sanitizeEnv(extra) {
  const merged = { ...process.env, ...extra };
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

  if (isWin) {
    const required = ["SystemRoot", "ComSpec", "WINDIR", "PATHEXT", "PATH"];
    for (const key of required) {
      if (!sanitized[key] && process.env[key]) {
        sanitized[key] = String(process.env[key]);
      }
    }
  }

  return sanitized;
}

function pipe(proc) {
  if (proc.stdout) {
    proc.stdout.on("data", (data) => {
      process.stdout.write(`[cloud] ${data}`);
    });
  }
  if (proc.stderr) {
    proc.stderr.on("data", (data) => {
      process.stderr.write(`[cloud] ${data}`);
    });
  }
}

const cloudRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(cloudRoot, "src", "solo.ts");
const workerEntry = path.join(cloudRoot, "src", "worker", "index.ts");
console.log(
  `[worker] launcher=v${launcherVersion} node=${process.version} entry=${workerEntry}`
);

function stripNodeOptions(value) {
  if (!value) {
    return undefined;
  }
  const parts = value.split(" ").filter((part) => {
    return !part.includes("--loader") && !part.includes("ts-node/esm");
  });
  return parts.length > 0 ? parts.join(" ") : undefined;
}

const env = sanitizeEnv({
  EVB_RUN_MODE: process.env.EVB_RUN_MODE ?? "solo",
  EVB_DEV_NO_REDIS: process.env.EVB_DEV_NO_REDIS ?? "1",
  TS_NODE_PROJECT: path.join(cloudRoot, "tsconfig.json"),
  TS_NODE_TRANSPILE_ONLY: "1",
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: "CommonJS" }),
  NODE_OPTIONS: stripNodeOptions(process.env.NODE_OPTIONS)
});

const args = ["-r", "ts-node/register/transpile-only", entry];
const child = spawn(process.execPath, args, {
  cwd: cloudRoot,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: false
});

pipe(child);
let shuttingDown = false;

child.on("error", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  const code = err && typeof err === "object" && "code" in err ? err.code : "unknown";
  console.error(`[cloud] Failed to spawn: ${code} ${message}`);
  console.error(`[cloud] cmd=${process.execPath} args=${JSON.stringify(args)} cwd=${cloudRoot}`);
  console.error(
    `[cloud] env summary PORT=${env.PORT ?? ""} EVB_RUN_MODE=${env.EVB_RUN_MODE ?? ""} EVB_INSTANCE_ID=${env.EVB_INSTANCE_ID ?? ""}`
  );
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (shuttingDown) {
    process.exit(code ?? 0);
    return;
  }
  if (code && code !== 0) {
    process.exit(code);
    return;
  }
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(1);
});

const shutdown = () => {
  shuttingDown = true;
  child.kill();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
