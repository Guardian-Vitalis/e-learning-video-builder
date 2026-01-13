import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { loadEnvForDoctor } from "../src/doctorEnv.js";

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

test("loads repo env and workspace overrides without overriding existing env", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "doctor-env-"));
  try {
    const repoRoot = path.join(tmpRoot, "repo");
    const packageRoot = path.join(repoRoot, "apps", "local-avatar-engine");
    await writeFile(path.join(repoRoot, ".env"), "REPO_VALUE=repo-default\n");
    await writeFile(path.join(repoRoot, ".env.local"), "SHARED=repo\n");
    await writeFile(path.join(packageRoot, ".env.local"), "SHARED=workspace\nWORKSPACE_ONLY=1\n");

    const baseEnv = { EXISTING: "keep" };
    const { loadedFiles, merged, env } = loadEnvForDoctor({ repoRoot, packageRoot, baseEnv });
    assert(loadedFiles.length >= 3, "should load repo/.env, repo/.env.local, package/.env.local");
    assert.equal(merged.SHARED, "workspace");
    assert.equal(merged.WORKSPACE_ONLY, "1");
    assert.equal(env.REPO_VALUE, "repo-default");
    assert.equal(env.SHARED, "workspace");
    assert.equal(env.WORKSPACE_ONLY, "1");
    assert.equal(env.EXISTING, "keep");
    assert.equal(baseEnv.REPO_VALUE, undefined);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
