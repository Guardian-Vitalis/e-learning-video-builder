const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const vitestPath = path.resolve(__dirname, "..", "node_modules", "vitest", "vitest.mjs");
const testFilter = "packages/shared/src/";
const extraArgs = process.argv.slice(2);
const args = [vitestPath, "--run", testFilter, ...extraArgs];
const preload = path.resolve(__dirname, "vite-no-net-use.cjs").replace(/\\/g, "/");
const existingNodeOptions = process.env.NODE_OPTIONS || "";
const quotedPreload = /[\s"]/g.test(preload) ? `"${preload.replace(/"/g, '\\"')}"` : preload;
const requireOption = `--require ${quotedPreload}`;
const nodeOptions = existingNodeOptions
  ? `${existingNodeOptions} ${requireOption}`
  : requireOption;
const env = {
  ...process.env,
  NODE_OPTIONS: nodeOptions,
};

if (process.platform === "win32") {
  const esbuildPlatform = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
  const esbuildBin = path.resolve(
    __dirname,
    "..",
    "node_modules",
    "@esbuild",
    esbuildPlatform,
    "esbuild.exe"
  );
  if (fs.existsSync(esbuildBin)) {
    const esbuildTempDir = path.join(os.tmpdir(), "evb-esbuild");
    const esbuildTempPath = path.join(esbuildTempDir, "esbuild.exe");
    try {
      fs.mkdirSync(esbuildTempDir, { recursive: true });
      const srcStat = fs.statSync(esbuildBin);
      const dstStat = fs.existsSync(esbuildTempPath) ? fs.statSync(esbuildTempPath) : null;
      if (!dstStat || dstStat.size !== srcStat.size || dstStat.mtimeMs !== srcStat.mtimeMs) {
        fs.copyFileSync(esbuildBin, esbuildTempPath);
      }
      env.ESBUILD_BINARY_PATH = esbuildTempPath.replace(/\\/g, "/");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[test:shared] Unable to stage esbuild binary: ${message}`);
    }
  }
}

const child = childProcess.spawn(process.execPath, args, {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
