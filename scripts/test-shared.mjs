import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(rootDir, "packages", "shared", "vitest.config.ts");

if (!process.env.VITE_CACHE_DIR) {
  process.env.VITE_CACHE_DIR = path.join(os.tmpdir(), "evb-vite-cache");
}
if (!process.env.VITE_PRESERVE_SYMLINKS) {
  process.env.VITE_PRESERVE_SYMLINKS = "1";
}

const args = process.argv.slice(2);
const options = {
  config: configPath,
  run: !args.includes("--watch"),
  watch: args.includes("--watch"),
};

const ctx = await startVitest("test", args, options);
if (!ctx) {
  process.exit(1);
}

const exitCode = await ctx?.exitCode;
process.exit(exitCode ?? 0);
