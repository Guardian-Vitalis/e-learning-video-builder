import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const GLOBAL_FLAG = "__evbEnvBootstrapLoaded";
const globalScope = globalThis as typeof globalThis & { [GLOBAL_FLAG]?: boolean };

const bootstrapRepoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const bootstrapAppRoot = path.resolve(bootstrapRepoRoot, "apps", "cloud");
const loadedEnvFiles: string[] = [];

function loadEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) return false;
  dotenv.config({ path: envPath, override: true });
  loadedEnvFiles.push(envPath);
  return true;
}

export function getEnvBootstrapState() {
  return {
    repoRoot: bootstrapRepoRoot,
    loadedFiles: [...loadedEnvFiles]
  };
}

if (!globalScope[GLOBAL_FLAG]) {
  globalScope[GLOBAL_FLAG] = true;

  const candidates = [
    path.join(bootstrapRepoRoot, ".env"),
    path.join(bootstrapRepoRoot, ".env.local"),
    path.join(bootstrapAppRoot, ".env"),
    path.join(bootstrapAppRoot, ".env.local")
  ];

  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }

  if (process.env.EVB_DEBUG_ENV_BOOTSTRAP === "1") {
    console.log(`[EVB] envBootstrap loaded: ${loadedEnvFiles.join(", ") || "<none>"}`);
    const value = process.env.AVATAR_PROVIDER?.trim() || "<unset>";
    console.log(`[EVB] AVATAR_PROVIDER=${value}`);
  } else if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    const value = process.env.AVATAR_PROVIDER?.trim() || "<unset>";
    console.log(`[EVB] AVATAR_PROVIDER=${value}`);
  }
}
