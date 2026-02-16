const childProcess = require("node:child_process");

const originalExec = childProcess.exec;
const originalExecFile = childProcess.execFile;
const originalSpawn = childProcess.spawn;

function isNetUseCommand(command, args) {
  if (typeof command === "string" && /^net\s+use\b/i.test(command.trim())) {
    return true;
  }
  if (typeof command === "string" && command.toLowerCase().endsWith("net.exe")) {
    return Array.isArray(args) && args[0] && args[0].toLowerCase() === "use";
  }
  if (typeof command === "string" && command.toLowerCase().includes("cmd")) {
    const joined = Array.isArray(args) ? args.join(" ") : "";
    return /net\s+use/i.test(joined);
  }
  return false;
}

childProcess.exec = (command, ...args) => {
  if (isNetUseCommand(command, [])) {
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) {
      callback(null, "", "");
    }
    return { pid: 0, kill() {} };
  }
  return originalExec(command, ...args);
};

childProcess.execFile = (file, args, options, callback) => {
  if (isNetUseCommand(file, args)) {
    if (typeof options === "function") {
      options(null, "", "");
      return { pid: 0, kill() {} };
    }
    if (typeof callback === "function") {
      callback(null, "", "");
    }
    return { pid: 0, kill() {} };
  }
  return originalExecFile(file, args, options, callback);
};

childProcess.spawn = (command, args, options) => {
  const esbuildPath = process.env.ESBUILD_BINARY_PATH;
  try {
    if (typeof command === "string" && esbuildPath) {
      const normalized = command.replace(/\\/g, "/").toLowerCase();
      if (normalized.includes("/@esbuild/") && normalized.endsWith("/esbuild.exe")) {
        const child = originalSpawn(esbuildPath, args, options);
        if (process.env.EVB_LOG_TESTS === "1") {
          console.log(`[test:shared] spawn override ${command} -> ${esbuildPath}`);
          child.on("error", (error) => {
            console.warn(`[test:shared] spawn error: ${error.message}`);
          });
        }
        return child;
      }
    }
    const child = originalSpawn(command, args, options);
    if (process.env.EVB_LOG_TESTS === "1") {
      const label = typeof command === "string" ? command : "spawn";
      child.on("error", (error) => {
        console.warn(`[test:shared] spawn error (${label}): ${error.message}`);
      });
    }
    return child;
  } catch (error) {
    if (process.env.EVB_LOG_TESTS === "1") {
      const label = typeof command === "string" ? command : "spawn";
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[test:shared] spawn throw (${label}): ${message}`);
      if (Array.isArray(args)) {
        console.warn(`[test:shared] spawn args: ${args.join(" ")}`);
      }
    }
    throw error;
  }
};
