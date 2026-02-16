import test from "node:test";
import assert from "node:assert/strict";
import { defaultPythonProbe } from "../src/pythonProbe.js";

function makeJsonPayload(overrides = {}) {
  return JSON.stringify({
    sys_executable: "C:\\python.exe",
    version: "3.10.13",
    torch: "2.0.1",
    cuda: true,
    mmengine: "0.10.4",
    mmcv: "2.0.1",
    mmdet: "3.3.0",
    mmpose: "1.3.2",
    ...overrides
  });
}

test("python probe succeeds with noisy stdout and non-empty stderr", () => {
  const payload = makeJsonPayload();
  const spawnSyncStub = () => ({
    status: 0,
    stdout: `warning line\n${payload}\n`,
    stderr: "torch warning"
  });
  const result = defaultPythonProbe("python", 1000, spawnSyncStub);
  assert.equal(result.ok, true);
  assert.equal(result.version, "3.10.13");
  assert.equal(result.exe, "C:\\python.exe");
  assert.equal(result.stderr, "torch warning");
  assert.equal(result.data?.torch, "2.0.1");
});

test("python probe fails when exit code non-zero", () => {
  const payload = makeJsonPayload();
  const spawnSyncStub = () => ({
    status: 1,
    stdout: payload,
    stderr: "error"
  });
  const result = defaultPythonProbe("python", 1000, spawnSyncStub);
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("exit 1"));
});

test("python probe reports spawnBlocked when EPERM occurs", () => {
  let invoked = 0;
  const spawnSyncStub = () => {
    invoked += 1;
    if (invoked === 1) {
      const err = new Error("EPERM");
      err.code = "EPERM";
      throw err;
    }
    return {
      status: 0,
      stdout: makeJsonPayload(),
      stderr: ""
    };
  };
  const result = defaultPythonProbe("python", 1000, spawnSyncStub);
  assert.equal(result.ok, false);
  assert.equal(result.spawnBlocked, true);
  assert.ok(result.reason?.includes("EPERM") || result.reason?.includes("spawn_blocked"));
});
