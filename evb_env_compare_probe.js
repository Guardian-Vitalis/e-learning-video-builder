const { spawnSync } = require("child_process");

const py = process.env.EVB_MUSETALK_PYTHON || "python";
const code = `
import json, sys
import torch, mmengine, mmcv, mmdet, mmpose
print(json.dumps({"ok": True, "torch": torch.__version__, "cuda": torch.cuda.is_available()}))
`;

function run(label, env) {
  const r = spawnSync(py, ["-c", code], { encoding: "utf8", env });
  console.log("\n==", label, "==");
  console.log("STATUS=", r.status);
  console.log("STDOUT=", r.stdout);
  console.log("STDERR=", r.stderr);
  console.log("ERROR=", r.error);
}

run("INHERIT (expected OK)", process.env);

// Simulate a broken doctor: minimal env only
run("MINIMAL ENV (often breaks torch on Windows)", {
  EVB_MUSETALK_PYTHON: process.env.EVB_MUSETALK_PYTHON,
  EVB_MUSETALK_REPO_DIR: process.env.EVB_MUSETALK_REPO_DIR,
  EVB_MUSETALK_MODELS_DIR: process.env.EVB_MUSETALK_MODELS_DIR,
  EVB_FFMPEG_PATH: process.env.EVB_FFMPEG_PATH
});
