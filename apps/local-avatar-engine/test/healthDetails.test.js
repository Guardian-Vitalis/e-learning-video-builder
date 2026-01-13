import test from "node:test";
import assert from "node:assert/strict";
import { collectHealthDetails } from "../src/healthDetails.js";

function makeRunCommand() {
  return async (cmd, args) => {
    if (args.includes("-c")) {
      return {
        ok: true,
        stdout: JSON.stringify({
          ok: true,
          python: "3.10.13",
          torch: "2.0.1",
          cuda: true,
          mmengine: "0.10.4",
          mmcv: "2.0.1",
          mmdet: "3.3.0",
          mmpose: "1.3.2"
        })
      };
    }
    return { ok: true, stdout: "Python 3.10.13" };
  };
}

function makePythonProbe(overrides = {}) {
  const base = {
    ok: true,
    version: "3.10.13",
    exe: "C:\\python.exe",
    spawnBlocked: false,
    data: {
      torch: "2.0.1",
      cuda: true,
      mmengine: "0.10.4",
      mmcv: "2.0.1",
      mmdet: "3.3.0",
      mmpose: "1.3.2"
    },
    stdout: "",
    stderr: ""
  };
  return () => ({ ...base, ...overrides, data: { ...base.data, ...(overrides.data ?? {}) } });
}

test("health details reports missing weights when files absent", async () => {
  const details = await collectHealthDetails({
    repoDir: "C:\\missing",
    existsSync: () => false,
    runCommand: makeRunCommand(),
    pythonProbe: makePythonProbe(),
    cache: { getSummary: () => ({ preparedAvatars: 0 }) }
  });
  assert.equal(details.musetalk.models.missing.length > 0, true);
  assert.ok(details.actionItems.some((item) => item.includes("download_weights")));
});

test("health details reports ok when weights present", async () => {
  const details = await collectHealthDetails({
    repoDir: "C:\\repo",
    existsSync: () => true,
    runCommand: makeRunCommand(),
    pythonProbe: makePythonProbe(),
    cache: { getSummary: () => ({ preparedAvatars: 1 }) }
  });
  assert.equal(details.musetalk.models.missing.length, 0);
  assert.equal(details.musetalk.torch.cudaAvailable, true);
});

test("health details reports spawnBlocked when python spawn fails", async () => {
  const details = await collectHealthDetails({
    repoDir: "C:\\repo",
    existsSync: () => true,
    runCommand: async () => ({ ok: false, spawnBlocked: true, reason: "spawn_blocked" }),
    pythonProbe: makePythonProbe({ ok: false, spawnBlocked: true, reason: "spawn_blocked" }),
    cache: { getSummary: () => ({ preparedAvatars: 0 }) }
  });
  assert.equal(details.musetalk.python.spawnBlocked, true);
  assert.equal(details.musetalk.ffmpeg.spawnBlocked, true);
  assert.ok(details.actionItems.some((item) => item.toLowerCase().includes("controlled folder access")));
});

test("health details warns about PYTHON version mismatch", async () => {
  const details = await collectHealthDetails({
    repoDir: "C:\\repo",
    existsSync: () => true,
    runCommand: makeRunCommand(),
    pythonProbe: makePythonProbe({ ok: false, version: "3.13.0" }),
    cache: { getSummary: () => ({ preparedAvatars: 0 }) }
  });
  assert.ok(
    details.actionItems.some((item) => item.includes("Python 3.10")),
    "expects python 3.10 warning"
  );
});

test("health details warns when repoDir missing", async () => {
  const details = await collectHealthDetails({
    repoDir: "C:\\missing",
    existsSync: () => false,
    runCommand: makeRunCommand(),
    pythonProbe: makePythonProbe(),
    cache: { getSummary: () => ({ preparedAvatars: 0 }) }
  });
  assert.ok(details.actionItems.some((item) => item.includes("repo root")));
  assert.equal(details.resolved.repoDir, "C:\\missing");
});
