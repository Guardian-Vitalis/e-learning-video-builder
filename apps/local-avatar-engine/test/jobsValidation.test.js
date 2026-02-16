import test from "node:test";
import assert from "node:assert/strict";

test("buildInvalidRequestPayload includes required diagnostics for empty body", async () => {
  process.env.EVB_LOCAL_AVATAR_DISABLE_LISTEN = "1";
  const mod = await import(`../src/server.js?test=${Date.now()}`);
  const body = mod.buildInvalidRequestPayload({}, "application/json");

  assert.equal(body.error, "invalid_request");
  assert.deepEqual(body.required, ["jobId", "clipId", "imagePngBase64"]);
  assert.deepEqual(body.receivedKeys, []);
  assert.equal(body.contentType, "application/json");
  assert.ok(typeof body.hint === "string" && body.hint.length > 0);
});

test("buildInvalidRequestPayload reports received keys when one required field is missing", async () => {
  process.env.EVB_LOCAL_AVATAR_DISABLE_LISTEN = "1";
  const mod = await import(`../src/server.js?test=${Date.now()}-partial`);
  const body = mod.buildInvalidRequestPayload(
    { jobId: "job-1", clipId: "clip-1" },
    "application/json"
  );

  assert.equal(body.error, "invalid_request");
  assert.ok(Array.isArray(body.receivedKeys));
  assert.equal(body.receivedKeys.includes("jobId"), true);
  assert.equal(body.receivedKeys.includes("clipId"), true);
  assert.equal(body.receivedKeys.includes("imagePngBase64"), false);
});
