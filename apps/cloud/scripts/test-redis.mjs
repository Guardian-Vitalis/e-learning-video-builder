import { spawn } from "node:child_process";

const isWin = process.platform === "win32";
const command = isWin ? "yarn.cmd" : "yarn";

if (!process.env.REDIS_URL) {
  console.error("[test] REDIS_URL is required for Redis tests.");
  process.exit(1);
}

const env = {
  ...process.env,
  EVB_RUN_REDIS_TESTS: "1",
  NODE_ENV: process.env.NODE_ENV ?? "test"
};

const child = spawn(command, ["test"], { env, stdio: "inherit" });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});