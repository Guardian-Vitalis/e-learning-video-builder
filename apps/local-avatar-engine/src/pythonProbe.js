import { spawnSync } from "node:child_process";

const PYTHON_PROBE_SCRIPT = [
  "import json,sys",
  "import torch,mmengine,mmcv,mmdet,mmpose",
  "print(json.dumps({",
  '  "sys_executable": sys.executable,',
  '  "version": sys.version.split()[0],',
  '  "torch": torch.__version__,',
  '  "cuda": torch.cuda.is_available(),',
  '  "mmengine": mmengine.__version__,',
  '  "mmcv": mmcv.__version__,',
  '  "mmdet": mmdet.__version__,',
  '  "mmpose": mmpose.__version__',
  "}))"
].join("\n");

export function parseJsonFromStdout(text) {
  if (!text) {
    return null;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  const payload = text.slice(start, end + 1);
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function defaultPythonProbe(pythonBin, timeoutMs, spawnSyncImpl = spawnSync) {
  try {
    const result = spawnSyncImpl(pythonBin, ["-c", PYTHON_PROBE_SCRIPT], {
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs
    });
    const stdout = result?.stdout ?? "";
    const stderr = result?.stderr ?? "";
    const spawnBlocked = Boolean(result?.error && result.error.code === "EPERM");
    const data = parseJsonFromStdout(stdout);
    const version = data?.version;
    const exe = data?.sys_executable ?? pythonBin;
    const truncatedStderr = stderr ? stderr.slice(0, 400) : undefined;
    if (result?.status !== 0 || result?.signal || spawnBlocked || !data) {
      const reason =
        spawnBlocked
          ? "spawn_blocked"
          : result?.status != null
            ? `python import checks failed (exit ${result.status})`
            : "python import checks failed";
      return {
        ok: false,
        reason,
        spawnBlocked,
        stderr,
        stdout,
        version,
        exe,
        error: truncatedStderr
      };
    }
    return {
      ok: true,
      version,
      exe,
      spawnBlocked: false,
      stderr,
      stdout,
      data
    };
  } catch (err) {
    const spawnBlocked = Boolean(err && err.code === "EPERM");
    return {
      ok: false,
      reason: err?.message ?? "python import checks failed",
      spawnBlocked,
      stderr: "",
      stdout: "",
      error: err?.message ?? String(err)
    };
  }
}
