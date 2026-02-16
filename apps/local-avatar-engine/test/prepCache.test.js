import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { buildPrepKey, PrepCache } from "../src/prepCache.js";

test("buildPrepKey changes when bboxShift changes", () => {
  const base = buildPrepKey({
    avatarId: "demo",
    fps: 25,
    bboxShift: -7
  });
  const changed = buildPrepKey({
    avatarId: "demo",
    fps: 25,
    bboxShift: -8
  });
  assert.notEqual(base, changed);
});

test("buildPrepKey is stable for identical inputs", () => {
  const key1 = buildPrepKey({
    avatarId: "demo",
    fps: 25,
    bboxShift: -7
  });
  const key2 = buildPrepKey({
    avatarId: "demo",
    fps: 25,
    bboxShift: -7
  });
  assert.equal(key1, key2);
});

test("PrepCache force prepare bypasses cache hit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-prep-cache-"));
  const cache = new PrepCache({ cacheDir: tempDir });
  let prepareCalls = 0;
  const prepareFn = async () => {
    prepareCalls += 1;
  };
  const key = "k1";
  assert.equal(cache.has(key), false);
  const first = await cache.getOrPrepare({ key, fps: 25, bboxShift: 0, prepareFn, force: false });
  const second = await cache.getOrPrepare({ key, fps: 25, bboxShift: 0, prepareFn, force: false });
  const third = await cache.getOrPrepare({ key, fps: 25, bboxShift: 0, prepareFn, force: true });
  assert.equal(cache.has(key), true);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(third.cacheHit, false);
  assert.equal(prepareCalls, 2);
  await fs.rm(tempDir, { recursive: true, force: true });
});
