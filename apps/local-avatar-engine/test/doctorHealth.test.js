import test from "node:test";
import assert from "node:assert/strict";
import { getDoctorHealth } from "../src/doctorHealth.js";

test("doctor health uses loader and collector, exposes env files", async () => {
  const fakeDetails = {
    ok: true,
    mode: "musetalk",
    musetalk: {
      repoDirExists: true,
      python: { ok: true },
      torch: { ok: true },
      mmlabImports: { mmengine: { ok: true }, mmcv: { ok: true }, mmdet: { ok: true }, mmpose: { ok: true } },
      ffmpeg: { ok: true },
      models: { missing: [], present: [] }
    },
    cache: { preparedAvatars: 0 }
  };
  const collector = async ({ env }) => ({
    ...fakeDetails,
    resolved: { foo: "bar", envFilesLoaded: env.BAR ? ["test"] : [] }
  });
  const loader = ({ baseEnv }) => ({
    env: { ...baseEnv, BAR: "baz" },
    loadedFiles: ["repo/.env"]
  });
  const details = await getDoctorHealth({ envBase: { FOO: "1" }, envLoader: loader, healthCollector: collector });
  assert.deepEqual(details.resolved.envFilesLoaded, ["repo/.env"]);
  assert.equal(details.resolved.foo, "bar");
});
