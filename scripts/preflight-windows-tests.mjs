const cwd = process.cwd();
const platform = process.platform;
const nodeVersion = process.version;
const isWindows = platform === "win32";

import { existsSync } from "node:fs";
import path from "node:path";

const allowOneDriveEnv = process.env.EVB_ALLOW_ONEDRIVE || "";
const allowOneDrive = ["1", "true"].includes(allowOneDriveEnv.toLowerCase());
const cwdLower = cwd.toLowerCase();
const hasOneDrive = cwdLower.includes("\\onedrive\\");
const hasDesktop = cwdLower.includes("\\desktop\\");
const hasDocuments = cwdLower.includes("\\documents\\");
const isRiskyPath = hasOneDrive || hasDesktop || hasDocuments;
const esbuildPath = path.join(cwd, "node_modules", "esbuild", "esbuild.exe");
const esbuildExists = isWindows ? existsSync(esbuildPath) : true;
const likelyDefenderIssue = isWindows && !esbuildExists;

console.log("Windows test preflight");
console.log(`- cwd: ${cwd}`);
console.log(`- platform: ${platform}`);
console.log(`- node: ${nodeVersion}`);
console.log(`- includes \\OneDrive\\: ${hasOneDrive}`);
console.log(`- includes \\Desktop\\: ${hasDesktop}`);
console.log(`- includes \\Documents\\: ${hasDocuments}`);
if (isWindows) {
  console.log(`- esbuild.exe present: ${esbuildExists}`);
}

if (isWindows && (isRiskyPath || likelyDefenderIssue)) {
  console.log("");
  console.log("========================================");
  console.log("WARNING: Risky Windows repo location");
  console.log("This setup can trigger EPERM/spawn issues.");
  console.log("See docs/windows_one_drive.md");
  console.log("========================================");
  console.log("");
  if (hasOneDrive && allowOneDrive) {
    console.log(
      "WARNING: OneDrive detected but EVB_ALLOW_ONEDRIVE=1 set; bypassing preflight at your own risk."
    );
    console.log("");
    console.log("Preflight OK");
    process.exit(0);
  }
  if (likelyDefenderIssue) {
    console.log("Warning: esbuild.exe is missing (Defender/quarantine is common).");
    console.log("");
  }
  console.log("Top fixes:");
  console.log("1) Move the repo out of OneDrive/Desktop/Documents (example: C:\\dev\\evb).");
  console.log("2) Add a Defender exclusion for the repo folder.");
  console.log("3) Reinstall dependencies: rmdir /s /q node_modules && yarn install");
  process.exit(2);
}

console.log("Preflight OK");
process.exit(0);
