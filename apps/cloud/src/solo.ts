import "dotenv/config";
import { startServer } from "./index";
import { startWorker } from "./worker/runWorker";
import { getQueueBackend, getStoreBackend } from "./lib/config";

const launcherVersion = "SOLO-CJS-2026-01-01";
console.log(`[cloud] launcher=v${launcherVersion} node=${process.version}`);

startServer();
console.log(
  `[EVB] worker=started mode=solo queue=${getQueueBackend()} store=${getStoreBackend()}`
);

startWorker().catch((err) => {
  console.error("worker failed to start (solo)", err);
  process.exit(1);
});
