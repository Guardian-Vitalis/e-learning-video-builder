import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = process.env.TEMP || os.tmpdir();
const reportPrefix = "evb_windows_lockdown_report_";
const ticketPath = path.join("docs", "windows_lockdown_it_ticket.md");

const findLatestReport = () => {
  try {
    const entries = readdirSync(tempDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(reportPrefix))
      .map((entry) => {
        const fullPath = path.join(tempDir, entry.name);
        const stat = statSync(fullPath);
        return { path: fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries.length > 0 ? entries[0].path : null;
  } catch {
    return null;
  }
};

const extractSection = (content, heading, nextHeading) => {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) {
    return null;
  }
  const endIndex = nextHeading
    ? lines.findIndex((line, idx) => idx > startIndex && line.trim() === nextHeading)
    : -1;
  const sliceEnd = endIndex === -1 ? lines.length : endIndex;
  const sectionLines = lines.slice(startIndex + 1, sliceEnd);
  return sectionLines.join("\n").trim();
};

const latestReport = findLatestReport();
let reproductionBlock = null;
let allowlistBlock = null;

try {
  const ticketContent = readFileSync(ticketPath, "utf-8");
  reproductionBlock = extractSection(
    ticketContent,
    "Reproduction (copy/paste)",
    "Minimum-viable allowlist request"
  );
  allowlistBlock = extractSection(
    ticketContent,
    "Minimum-viable allowlist request",
    "Recommended remediation options (ranked)"
  );
} catch {
  reproductionBlock = null;
  allowlistBlock = null;
}

const outputBlock = (label, block) => {
  console.log(label);
  if (block) {
    console.log(block);
  } else {
    console.log("Could not parse section from docs/windows_lockdown_it_ticket.md.");
  }
};

console.log(`Latest report: ${latestReport || "not found"}`);
console.log("");
outputBlock("Reproduction (copy/paste):", reproductionBlock);
console.log("");
outputBlock("Minimum-viable allowlist request:", allowlistBlock);
