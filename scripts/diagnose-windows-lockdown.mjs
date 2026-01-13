import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, "-");
const tempDir = process.env.TEMP || os.tmpdir();
const reportPath = path.join(tempDir, `evb_windows_lockdown_report_${timestamp}.txt`);

const lines = [];
const add = (label, value) => {
  lines.push(`${label}: ${value}`);
};

const addSection = (title) => {
  lines.push("");
  lines.push(`[${title}]`);
};

const trimText = (text, maxLen = 200) => {
  const value = (text || "").toString().trim();
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen)}...`;
};

const safeSpawn = (command, args = []) => {
  try {
    const result = spawnSync(command, args, { encoding: "utf-8", windowsHide: true });
    return {
      status: result.status,
      errorCode: result.error ? result.error.code : null,
      error: result.error ? result.error.message : null,
      stdout: trimText(result.stdout),
      stderr: trimText(result.stderr),
    };
  } catch (error) {
    return {
      status: null,
      errorCode: error?.code || null,
      error: error?.message || String(error),
      stdout: "",
      stderr: "",
    };
  }
};

const writeProbe = (targetDir, name) => {
  try {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    const probePath = path.join(targetDir, `evb_probe_${Date.now()}.txt`);
    writeFileSync(probePath, "ok");
    return `ok (${probePath})`;
  } catch (error) {
    return `failed (${error?.code || "error"}: ${error?.message || "unknown"})`;
  }
};

add("timestamp", now.toISOString());
add("user", `${process.env.USERDOMAIN || "unknown"}\\${process.env.USERNAME || "unknown"}`);
add("cwd", process.cwd());
add("node", process.version);
add("node execPath", process.execPath);
add("platform", process.platform);
add("arch", process.arch);
add("TEMP", tempDir);
add("USERPROFILE", process.env.USERPROFILE || "unknown");
add("LOCALAPPDATA", process.env.LOCALAPPDATA || "unknown");
add("ComSpec", process.env.ComSpec || "unset");
add("SystemRoot", process.env.SystemRoot || "unset");
add("windir", process.env.windir || "unset");
add("PATH (head)", trimText(process.env.PATH || "", 300));
add("NODE_OPTIONS", process.env.NODE_OPTIONS || "unset");
add("ESBUILD_BINARY_PATH", process.env.ESBUILD_BINARY_PATH || "unset");
add("npm_execpath", process.env.npm_execpath || "unset");

const yarnVersion = safeSpawn("yarn", ["-v"]);
add("yarn -v", yarnVersion.error ? `error: ${yarnVersion.error}` : yarnVersion.stdout);

add("write TEMP", writeProbe(tempDir, "TEMP"));
add("write cwd", writeProbe(process.cwd(), "cwd"));
add(
  "write USERPROFILE",
  process.env.USERPROFILE ? writeProbe(process.env.USERPROFILE, "USERPROFILE") : "unset"
);
add(
  "write LOCALAPPDATA",
  process.env.LOCALAPPDATA ? writeProbe(process.env.LOCALAPPDATA, "LOCALAPPDATA") : "unset"
);

addSection("Spawn Matrix");
const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
const cmdAbs = process.env.ComSpec || path.join(systemRoot, "System32", "cmd.exe");
const psAbs = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

const spawnRows = [];
const addSpawnRow = (label, command, args) => {
  const result = safeSpawn(command, args);
  spawnRows.push({
    label,
    command,
    args,
    result,
  });
  lines.push(
    `${label}: status=${result.status} errorCode=${result.errorCode || "none"} error=${
      result.error || "none"
    }`
  );
  if (result.stdout) {
    lines.push(`  stdout: ${result.stdout}`);
  }
  if (result.stderr) {
    lines.push(`  stderr: ${result.stderr}`);
  }
};

addSpawnRow("cmd (name)", "cmd", ["/c", "echo", "cmd_ok"]);
addSpawnRow("cmd (abs)", cmdAbs, ["/c", "echo", "cmd_ok"]);
addSpawnRow("powershell (abs)", psAbs, ["-NoProfile", "-Command", "Write-Output ps_ok"]);
addSpawnRow("node child", process.execPath, ["-e", "console.log('child_node_ok')"]);
addSpawnRow("yarn (name)", "yarn", ["-v"]);

if (process.env.ESBUILD_BINARY_PATH) {
  addSpawnRow("esbuild (env)", process.env.ESBUILD_BINARY_PATH, ["--version"]);
}

addSection("Resolver Probes");
addSpawnRow("where cmd", "cmd", ["/c", "where", "cmd"]);
addSpawnRow("where powershell", "cmd", ["/c", "where", "powershell"]);
addSpawnRow("where node", "cmd", ["/c", "where", "node"]);
addSpawnRow("where yarn", "cmd", ["/c", "where", "yarn"]);
addSpawnRow("powershell Get-Command", psAbs, [
  "-NoProfile",
  "-Command",
  "Get-Command yarn,cmd,node,powershell | Select-Object -ExpandProperty Source",
]);

addSection("Reproduction (copy/paste)");
lines.push(`${cmdAbs} /c echo cmd_ok`);
lines.push(
  `${psAbs} -NoProfile -Command "Write-Output ps_ok"`
);
lines.push(`${process.execPath} -e "console.log('child_node_ok')"`);
lines.push(
  `${process.execPath} -e "require('child_process').spawnSync(process.env.ComSpec||'cmd',['/c','echo','spawn_ok'],{stdio:'inherit'});"`
);
if (process.env.ESBUILD_BINARY_PATH) {
  lines.push(`${process.env.ESBUILD_BINARY_PATH} --version`);
}

addSection("Interpretation");
const epermRows = spawnRows.filter((row) => row.result.errorCode === "EPERM");
if (epermRows.length > 0) {
  lines.push("Diagnosis: OS/security policy blocks process execution (EPERM). Not a PATH issue.");
  lines.push("Failing commands:");
  for (const row of epermRows) {
    lines.push(`- ${row.command} ${row.args.join(" ")}`);
  }
  lines.push("Allowlist targets (paths):");
  lines.push(`- node.exe: ${process.execPath}`);
  lines.push(`- cmd.exe: ${cmdAbs}`);
  lines.push(`- powershell.exe: ${psAbs}`);
  if (process.env.ESBUILD_BINARY_PATH) {
    lines.push(`- esbuild.exe: ${process.env.ESBUILD_BINARY_PATH}`);
  }
  if (process.env.npm_execpath) {
    lines.push(`- yarn launcher (npm_execpath): ${process.env.npm_execpath}`);
  }
  lines.push("Note: yarn may resolve to yarn.cmd or yarn.ps1 depending on PATH.");
} else {
  lines.push("Diagnosis: No EPERM detected in spawn matrix. Check PATH resolution or policy scope.");
}

addSection("Allowlist Request (minimum viable)");
lines.push("EPERM indicates execution is blocked for child processes. Minimum allowlist targets:");
lines.push(`- node.exe: ${process.execPath}`);
lines.push(`- cmd.exe: ${cmdAbs}`);
lines.push(`- powershell.exe: ${psAbs}`);
if (process.env.npm_execpath) {
  lines.push(`- yarn runtime path (npm_execpath): ${process.env.npm_execpath}`);
  lines.push("- allow pattern: %TEMP%\\xfs-*\\yarn (if path-based allowlist required)");
}
if (process.env.ESBUILD_BINARY_PATH) {
  lines.push(`- esbuild.exe: ${process.env.ESBUILD_BINARY_PATH}`);
}
lines.push("Justification: dev tooling uses Node to spawn cmd/powershell/yarn/esbuild; blocking prevents tests/builds.");

try {
  writeFileSync(reportPath, `${lines.join(os.EOL)}${os.EOL}`);
  console.log(`Wrote Windows lockdown report: ${reportPath}`);
} catch (error) {
  console.error("Failed to write Windows lockdown report.", error);
}
