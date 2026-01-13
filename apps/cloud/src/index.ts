import "dotenv/config";
import cors from "cors";
import express from "express";
import { HealthResponse } from "@evb/shared";
import { jobsRouter } from "./routes/jobs";
import { healthRouter } from "./routes/health";
import { workerRouter } from "./routes/worker";
import { adminRouter } from "./routes/admin";
import { importDocxRouter } from "./routes/importDocx";
import { createArtifactsRouter } from "./routes/artifacts";
import path from "node:path";

export function createApp() {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "50mb" }));
  const logHttp = process.env.EVB_LOG_HTTP === "1";
  if (logHttp) {
    app.use((req, res, next) => {
      const path = req.path;
      const shouldLog =
        path === "/v1/health" ||
        path === "/v1/worker/heartbeat" ||
        path.startsWith("/v1/jobs");
      if (!shouldLog) {
        return next();
      }
      res.on("finish", () => {
        console.log(`[cloud] http ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
      });
      return next();
    });
  }

  app.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  app.use("/v1", healthRouter);
  app.use("/v1", workerRouter);
  app.use("/v1", adminRouter);
  app.use("/v1/import", importDocxRouter);
  app.use("/v1/jobs", jobsRouter);
  app.use(
    "/v1/artifacts",
    createArtifactsRouter({
      artifactsDir: process.env.ARTIFACTS_DIR
        ? path.resolve(process.env.ARTIFACTS_DIR)
        : path.resolve(process.cwd(), ".artifacts")
    })
  );

  return app;
}

export function startServer(port = process.env.PORT ? Number(process.env.PORT) : 4000) {
  const app = createApp();
  const {
    getRunMode,
    getStoreBackend,
    getQueueBackend,
    isRedisEnabled,
    getInstanceId
  } = require("./lib/config");
  const mode = getRunMode();
  const store = getStoreBackend();
  const queue = getQueueBackend();
  const redisEnabled = isRedisEnabled();
  const instanceId = getInstanceId();
  app.listen(port, () => {
    console.log(`cloud listening on http://localhost:${port}`);
    console.log(
      `[EVB] mode=${mode} store=${store} queue=${queue} redisEnabled=${redisEnabled} port=${port} instanceId=${instanceId}`
    );
  });
  return app;
}

if (process.env.NODE_ENV !== "test" && require.main === module) {
  startServer();
}
