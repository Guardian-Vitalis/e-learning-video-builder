import type { AvatarProvider } from "./types";
import { createStubProvider } from "./stubProvider";
import { createLocalMusetalkProvider } from "./localMusetalkProvider";
import { getRunMode } from "../lib/config";

const supportedProviders = ["stub", "local_musetalk"] as const;
let loggedProvider = false;

function logProvider(provider: string, reason: string) {
  if (loggedProvider) {
    return;
  }
  loggedProvider = true;
  console.log(`[EVB] provider=${provider} reason=${reason}`);
}

export function getAvatarProviderFromEnv(
  env: NodeJS.ProcessEnv,
  mode: ReturnType<typeof getRunMode> = getRunMode()
): AvatarProvider {
  const raw = env.AVATAR_PROVIDER?.trim();
  if (!raw || raw === "stub") {
    if (mode === "solo") {
      logProvider("stub", raw ? "solo-default" : "missing-config");
    }
    return createStubProvider();
  }
  if (raw === "local_musetalk") {
    if (mode === "solo") {
      logProvider("local_musetalk", "env");
    }
    return createLocalMusetalkProvider();
  }
  if (mode === "solo") {
    logProvider("stub", "error-fallback");
    return createStubProvider();
  }
  throw new Error(
    `Unknown AVATAR_PROVIDER=${raw}. Supported: ${supportedProviders.join(", ")}`
  );
}
