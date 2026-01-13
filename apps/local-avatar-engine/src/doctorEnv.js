import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const ENV_FILES = [
  (root) => path.join(root, ".env"),
  (root) => path.join(root, ".env.local")
];

export function loadEnvForDoctor({ repoRoot, packageRoot, baseEnv = {} }) {
  const roots = [
    { root: repoRoot, label: "repo" },
    { root: packageRoot, label: "package" }
  ];
  const mergedValues = {};
  const loadedFiles = [];

  for (const { root } of roots) {
    if (!root) {
      continue;
    }
    for (const fileResolver of ENV_FILES) {
      const filePath = fileResolver(root);
      if (fs.existsSync(filePath)) {
        loadedFiles.push(filePath);
        const contents = fs.readFileSync(filePath, "utf8");
        const parsed = dotenv.parse(contents);
        Object.assign(mergedValues, parsed);
      }
    }
  }

  const mergedEnv = { ...baseEnv };
  const applied = {};
  for (const [key, value] of Object.entries(mergedValues)) {
    if (mergedEnv[key] === undefined) {
      mergedEnv[key] = value;
      applied[key] = value;
    }
  }

  return { loadedFiles, merged: applied, env: mergedEnv };
}
