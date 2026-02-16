import "./lib/envBootstrap";
import express from "express";
import { HealthResponse } from "@evb/shared";
import { jobsRouter } from "./routes/jobs";
import { healthRouter } from "./routes/health";
import { workerRouter } from "./routes/worker";
import { adminRouter } from "./routes/admin";
import { importDocxRouter } from "./routes/importDocx";
import { createArtifactsRouter } from "./routes/artifacts";
import path from "node:path";
import { startWorker } from "./worker/runWorker";

console.log("[cloud] booted entrypoint:", __filename);

export function createApp() {
  const app = express();
  const isAllowedDevOrigin = (origin: string) =>
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /^http:\/\/\[\:\:1\](?::\d+)?$/.test(origin);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const originStr = typeof origin === "string" ? origin : undefined;
    if (req.url.startsWith("/v1/import")) {
      console.log(`[cloud] ${req.method} ${req.url} origin=${originStr ?? "-"}`);
    }
    if (originStr && isAllowedDevOrigin(originStr)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      (req.headers["access-control-request-headers"] as string) ??
        "content-type,authorization"
    );
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
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
  app.get("/v1/health", (_req, res) => {
    res.json({ ok: true });
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

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      error: "internal_error",
      message: String(err?.message ?? err)
    });
  });

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
  const server = app.listen(port, () => {
    console.log(`cloud listening on http://localhost:${port}`);
    console.log(
      `[EVB] mode=${mode} store=${store} queue=${queue} redisEnabled=${redisEnabled} port=${port} instanceId=${instanceId}`
    );
    console.log("[cloud] listening addr:", server.address());
  });
  const inlineWorkerDisabled = process.env.EVB_DISABLE_INLINE_WORKER === "1";
  const isSoloEntry = process.argv.some((arg) => arg.includes(`${path.sep}solo.ts`));
  if (!inlineWorkerDisabled && !isSoloEntry && mode === "solo" && store === "memory" && queue === "memory") {
    console.log("[EVB] inline-worker starting...");
    startWorker().catch((err) => {
      const message = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`[EVB] inline-worker crashed ${message}`);
    });
  }
  return app;
}

if (process.env.NODE_ENV !== "test" && require.main === module) {
  startServer();
}
