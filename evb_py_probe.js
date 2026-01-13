const { spawnSync } = require("child_process");

const py = process.env.EVB_MUSETALK_PYTHON || "python";

// Keep python output strictly JSON
const code = `
import json, sys
import torch, mmengine, mmcv, mmdet, mmpose
print(json.dumps({
  "sys_executable": sys.executable,
  "torch": torch.__version__,
  "cuda": torch.cuda.is_available(),
  "mmengine": mmengine.__version__,
  "mmcv": mmcv.__version__,
  "mmdet": mmdet.__version__,
  "mmpose": mmpose.__version__
}))
`;

const r = spawnSync(py, ["-c", code], { encoding: "utf8" });

console.log("PY=", py);
console.log("STATUS=", r.status);
console.log("STDOUT=", r.stdout);
console.log("STDERR=", r.stderr);
console.log("ERROR=", r.error);
