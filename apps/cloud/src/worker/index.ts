import "../lib/envBootstrap";
import { startWorker } from "./runWorker";

export { startWorker };

if (require.main === module) {
  startWorker().catch((err) => {
    console.error("worker failed to start", err);
    process.exit(1);
  });
}
