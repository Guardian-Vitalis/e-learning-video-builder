import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const repoRoot = process.cwd();
const debugEnabled = ["1", "true"].includes((process.env.EVB_DEBUG || "").toLowerCase());

const requireFromRepo = createRequire(import.meta.url);

const resolveEsbuildBinary = (esbuildPkgDir) => {
  const candidatePaths = [
    path.join(esbuildPkgDir, "bin", "esbuild.exe"),
    path.join(esbuildPkgDir, "esbuild.exe"),
  ];
  return candidatePaths.find((candidate) => existsSync(candidate)) || null;
};

const resolvePlatformEsbuildBinary = () => {
  const arch = process.arch;
  let platformPkg;
  if (arch === "x64") {
    platformPkg = "@esbuild/win32-x64";
  } else if (arch === "arm64") {
    platformPkg = "@esbuild/win32-arm64";
  } else {
    return { binary: null, pkgDir: null };
  }

  try {
    const pkgJsonPath = requireFromRepo.resolve(`${platformPkg}/package.json`, {
      paths: [repoRoot],
    });
    const pkgDir = path.dirname(pkgJsonPath);
    const binary = path.join(pkgDir, "esbuild.exe");
    return { binary: existsSync(binary) ? binary : null, pkgDir };
  } catch {
    return { binary: null, pkgDir: null };
  }
};

const runEsbuildInstallIfNeeded = async (esbuildPkgDir) => {
  const installJsPath = path.join(esbuildPkgDir, "install.js");
  if (!existsSync(installJsPath)) {
    return { attempted: false, error: null };
  }
  return new Promise((resolve) => {
    const installer = spawn(process.execPath, [installJsPath], {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    installer.on("exit", (code) => {
      resolve({
        attempted: true,
        error: code === 0 ? null : `install.js exited with code ${code}`,
      });
    });
    installer.on("error", (error) => {
      resolve({ attempted: true, error: error?.message || "install.js failed" });
    });
  });
};

const runLocalTests = () => {
  const childEnv = { ...process.env, ESBUILD_BINARY_PATH: process.env.ESBUILD_BINARY_PATH };
  const child = spawn("yarn", ["workspace", "@evb/local", "test:unit"], {
    stdio: "inherit",
    env: childEnv,
    shell: false,
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    if (error && error.code === "ENOENT") {
      const retry = spawn("yarn", ["workspace", "@evb/local", "test:unit"], {
        stdio: "inherit",
        env: childEnv,
        shell: true,
      });
      retry.on("exit", (code) => process.exit(code ?? 1));
      retry.on("error", (retryError) => {
        console.error("Failed to run local tests.", retryError);
        process.exit(1);
      });
      return;
    }
    console.error("Failed to run local tests.", error);
    process.exit(1);
  });
};

const ensureWindowsEsbuild = async () => {
  let esbuildPkgDir;
  let platformPkgDir = null;
  try {
    const pkgJsonPath = requireFromRepo.resolve("esbuild/package.json", {
      paths: [repoRoot],
    });
    esbuildPkgDir = path.dirname(pkgJsonPath);
  } catch (error) {
    console.error("Failed to resolve esbuild package.", error);
    process.exit(1);
  }

  let esbuildSource = resolveEsbuildBinary(esbuildPkgDir);
  if (!esbuildSource) {
    const platformResult = resolvePlatformEsbuildBinary();
    esbuildSource = platformResult.binary;
    platformPkgDir = platformResult.pkgDir;
  }

  let installAttempted = false;
  let installFailedReason = null;
  if (!esbuildSource) {
    const installResult = await runEsbuildInstallIfNeeded(esbuildPkgDir);
    installAttempted = installResult.attempted;
    installFailedReason = installResult.error;
    esbuildSource = resolveEsbuildBinary(esbuildPkgDir);
    if (!esbuildSource) {
      const platformResult = resolvePlatformEsbuildBinary();
      esbuildSource = platformResult.binary;
      platformPkgDir = platformResult.pkgDir;
    }
  }

  if (!esbuildSource) {
    console.error("esbuild.exe is missing after attempted repair.");
    console.error(`Resolved esbuild package dir: ${esbuildPkgDir}`);
    if (platformPkgDir) {
      console.error(`Resolved platform package dir: ${platformPkgDir}`);
    }
    console.error(`Install attempted: ${installAttempted}`);
    if (installFailedReason) {
      console.error(`Install error: ${installFailedReason}`);
    }
    console.error("Move repo out of OneDrive or add Defender exclusion; then run: yarn install");
    process.exit(1);
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const localAppDataDir = path.join(localAppData, "evb", "esbuild");
  const programsDir = path.join(localAppData, "Programs");
  const tempDir = path.join(os.tmpdir(), "evb-esbuild");

  const overrideDirRaw = process.env.EVB_ESBUILD_DIR ? process.env.EVB_ESBUILD_DIR.trim() : "";
  const overrideDir = overrideDirRaw ? path.resolve(overrideDirRaw) : null;
  const targetOptions = [
    ...(overrideDir ? [{ dir: overrideDir, file: "esbuild.exe" }] : []),
    { dir: localAppDataDir, file: "esbuild.exe" },
    { dir: programsDir, file: "evb-esbuild.exe", requireExisting: true },
    { dir: tempDir, file: "esbuild.exe" },
  ];

  const tryCopyToTarget = (target) => {
    try {
      if (target.requireExisting && !existsSync(target.dir)) {
        return { ok: false, error: new Error(`Missing ${target.dir}`) };
      }
      mkdirSync(target.dir, { recursive: true });
      const targetPath = path.join(target.dir, target.file);
      const data = readFileSync(esbuildSource);
      writeFileSync(targetPath, data);
      try {
        unlinkSync(`${targetPath}:Zone.Identifier`);
      } catch {
        // Ignore missing ADS or unsupported filesystem.
      }
      return { ok: true, path: targetPath };
    } catch (error) {
      return { ok: false, error };
    }
  };

  let esbuildTarget = null;
  let lastCopyError = null;
  for (const target of targetOptions) {
    const result = tryCopyToTarget(target);
    if (result.ok) {
      esbuildTarget = result.path;
      if (target.dir !== localAppDataDir) {
        console.warn(`Failed to prepare ${localAppDataDir}; using ${target.dir} instead.`);
      }
      break;
    }
    lastCopyError = result.error;
  }

  if (!esbuildTarget) {
    console.error("Failed to copy esbuild.exe to a safe path.", lastCopyError);
    process.exit(1);
  }

  process.env.ESBUILD_BINARY_PATH = esbuildTarget;
  console.log(`Using ESBUILD_BINARY_PATH=${esbuildTarget} (source=${esbuildSource})`);

  const smoke = spawnSync(esbuildTarget, ["--version"], {
    windowsHide: true,
    env: { ...process.env, ESBUILD_BINARY_PATH: esbuildTarget },
  });
  if (smoke.error || smoke.status !== 0) {
    const reason = smoke.error?.code || `exit ${smoke.status}`;
    if (smoke.error?.code === "EPERM") {
      console.error("System policy blocked esbuild execution (EPERM).");
      console.error("Run: yarn diagnose:windows and attach the report to IT/admin.");
      if (debugEnabled && smoke.error) {
        console.error(smoke.error);
      }
      process.exit(1);
    }
    console.error(`Smoke test: FAILED (${reason})`);
    if (debugEnabled && smoke.error) {
      console.error(smoke.error);
    }
    console.error(`esbuildTarget: ${esbuildTarget}`);
    console.error(`cwd: ${repoRoot}`);
    if (smoke.error?.message) {
      console.error(`error: ${smoke.error.message}`);
    }
    process.exit(1);
  }
  const version = (smoke.stdout || "").toString().trim() || (smoke.stderr || "").toString().trim();
  console.log(`Smoke test: OK (${version || "unknown"})`);
};

if (isWindows) {
  await ensureWindowsEsbuild();
}

runLocalTests();
