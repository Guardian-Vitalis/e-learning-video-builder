import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import { buildAvatarKey, buildMuseTalkArgs, runMuseTalkClip } from "../src/musetalkRunner.js";

test("buildAvatarKey is deterministic and uses avatarId prefix", () => {
  const imageBuffer = Buffer.from("avatar-image");
  const keyA = buildAvatarKey({ avatarId: "demo", imageBuffer });
  const keyB = buildAvatarKey({ avatarId: "demo", imageBuffer });
  assert.equal(keyA, keyB);
  assert.ok(keyA.startsWith("demo-"));
});

test("buildAvatarKey falls back to default when avatarId missing", () => {
  const imageBuffer = Buffer.from("avatar-image");
  const key = buildAvatarKey({ avatarId: "", imageBuffer });
  assert.ok(key.startsWith("default-"));
});

test("buildMuseTalkArgs selects v15 and v1 model paths", () => {
  const modelsDir = path.join("C:", "models");
  const configPath = path.join("C:", "tmp", "config.yaml");

  const argsV15 = buildMuseTalkArgs({
    configPath,
    version: "v15",
    modelsDir,
    ffmpegPath: undefined,
    fps: 25
  });
  assert.ok(argsV15.includes(path.join(modelsDir, "musetalkV15", "unet.pth")));

  const argsV1 = buildMuseTalkArgs({
    configPath,
    version: "v1",
    modelsDir,
    ffmpegPath: undefined,
    fps: 25
  });
  assert.ok(argsV1.includes(path.join(modelsDir, "musetalk", "pytorch_model.bin")));
});

const runIntegrationMuseTalkTests = process.env.EVB_RUN_MUSETALK_TESTS === "1";

function integrationPrereqSkipReason() {
  const repoDir = process.env.EVB_MUSETALK_REPO_DIR;
  const modelsDir = process.env.EVB_MUSETALK_MODELS_DIR;
  const pythonBin = process.env.EVB_MUSETALK_PYTHON || process.env.EVB_PYTHON_BIN;

  if (!repoDir) return "set EVB_MUSETALK_REPO_DIR";
  if (!modelsDir) return "set EVB_MUSETALK_MODELS_DIR";
  if (!pythonBin) return "set EVB_MUSETALK_PYTHON (or EVB_PYTHON_BIN)";
  if (!fsSync.existsSync(repoDir)) return `repo dir missing: ${repoDir}`;
  if (!fsSync.existsSync(modelsDir)) return `models dir missing: ${modelsDir}`;
  if (pythonBin.includes("\\") || pythonBin.includes("/")) {
    if (!fsSync.existsSync(pythonBin)) return `python not found: ${pythonBin}`;
  }
  return "";
}

const integrationTestName =
  "force preparation deletes avatar folder before spawn (integration; set EVB_RUN_MUSETALK_TESTS=1 to run)";

async function runForcePreparationDeletesAvatarFolderBeforeSpawn() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "musetalk-test-"));
  const repoDir = path.join(tempRoot, "repo");
  const scriptsDir = path.join(repoDir, "scripts");
  const modelsDir = path.join(repoDir, "models");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(modelsDir, { recursive: true });
  await fs.writeFile(path.join(scriptsDir, "realtime_inference.py"), "# stub\n", "utf8");

  const imageBuffer = Buffer.from("avatar-image");
  const audioBuffer = Buffer.from("audio-wav");
  const avatarKey = buildAvatarKey({ avatarId: "demo", imageBuffer });
  const avatarDir = path.join(repoDir, "results", "v15", "avatars", avatarKey);
  await fs.mkdir(avatarDir, { recursive: true });
  await fs.writeFile(path.join(avatarDir, "avatar_hash.txt"), "old", "utf8");
  await fs.writeFile(path.join(avatarDir, "old.txt"), "old", "utf8");

  let checked = false;
  const runCommand = async () => {
    const exists = await fs
      .stat(avatarDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
    checked = true;

    const outputDir = path.join(avatarDir, "vid_output");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "clip0.mp4"), Buffer.from("mp4"));
    return { stdout: "", stderr: "" };
  };

  try {
    await runMuseTalkClip({
      repoDir,
      pythonBin: "python",
      modelsDir,
      ffmpegPath: undefined,
      version: "v15",
      avatarId: "demo",
      imagePngBase64: imageBuffer.toString("base64"),
      audioWavBase64: audioBuffer.toString("base64"),
      fps: 25,
      bboxShift: 0,
      preparationHint: "force",
      timeoutMs: 1000,
      workRoot: path.join(tempRoot, "work-"),
      runCommand
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  assert.equal(checked, true);
}

if (!runIntegrationMuseTalkTests) {
  test.skip(integrationTestName, runForcePreparationDeletesAvatarFolderBeforeSpawn);
} else {
  const prereqReason = integrationPrereqSkipReason();
  if (prereqReason) {
    test.skip(
      `${integrationTestName} - Skipping MuseTalk integration test: ${prereqReason}`,
      runForcePreparationDeletesAvatarFolderBeforeSpawn
    );
  } else {
    test(integrationTestName, runForcePreparationDeletesAvatarFolderBeforeSpawn);
  }
}
