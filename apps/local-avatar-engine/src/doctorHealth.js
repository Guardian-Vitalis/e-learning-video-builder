import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvForDoctor } from "./doctorEnv.js";
import { collectHealthDetails } from "./healthDetails.js";

export async function getDoctorHealth({
  cache,
  envBase = process.env,
  envLoader = loadEnvForDoctor,
  healthCollector = collectHealthDetails
} = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(__filename), "..");
  const repoRoot = path.resolve(packageRoot, "..");
  const { env, loadedFiles } = envLoader({
    repoRoot,
    packageRoot,
    baseEnv: { ...envBase }
  });
  const details = await healthCollector({ env, cache });
  details.resolved = details.resolved ?? {};
  if (loadedFiles.length) {
    details.resolved.envFilesLoaded = loadedFiles;
  }
  return details;
}
