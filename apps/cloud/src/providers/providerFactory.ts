import type { AvatarProvider } from "./types";
import { createStubProvider } from "./stubProvider";
import { createLocalMusetalkProvider } from "./localMusetalkProvider";
import { getRunMode, getLocalAvatarConfig } from "../lib/config";
import { getAvatarPreset } from "@evb/shared";
import type { JobInput } from "../store/jobStore";

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

type ProviderSelection = {
  provider: AvatarProvider;
  reason: string;
  localAvatarUrl: string;
  hasPreparedAvatar: boolean;
};

function hasPreparedAvatar(input?: JobInput | null) {
  return Boolean(
    input?.localAvatarAdvanced?.avatarId ||
      (input?.manifest?.localAvatar && input.manifest.localAvatar.avatarId)
  );
}

export function selectAvatarProviderForJob(
  env: NodeJS.ProcessEnv,
  mode: ReturnType<typeof getRunMode>,
  jobInput?: JobInput | null
): ProviderSelection {
  const raw = env.AVATAR_PROVIDER?.trim();
  const localAvatarUrl = getLocalAvatarConfig().baseUrl.trim();
  const localAvailable = localAvatarUrl.length > 0;
  const prepared = hasPreparedAvatar(jobInput);
  const avatarPresetProvider = jobInput
    ? getAvatarPreset(jobInput.settings.avatarPresetId)?.provider
    : undefined;
  const preferLocal = prepared || avatarPresetProvider === "local_musetalk";

  if (preferLocal) {
    if (localAvailable) {
      return {
        provider: createLocalMusetalkProvider(),
        reason: prepared ? "prepared-avatar" : "avatar-preset",
        localAvatarUrl,
        hasPreparedAvatar: prepared
      };
    }
    if (mode === "solo") {
      return {
        provider: createStubProvider(),
        reason: "missing-local-avatar-url",
        localAvatarUrl,
        hasPreparedAvatar: prepared
      };
    }
  }

  if (!raw || raw === "stub") {
    return {
      provider: createStubProvider(),
      reason: mode === "solo" ? (raw ? "solo-default" : "missing-config") : "default",
      localAvatarUrl,
      hasPreparedAvatar: prepared
    };
  }
  if (raw === "local_musetalk") {
    if (!localAvailable && mode === "solo") {
      return {
        provider: createStubProvider(),
        reason: "missing-local-avatar-url",
        localAvatarUrl,
        hasPreparedAvatar: prepared
      };
    }
    return {
      provider: createLocalMusetalkProvider(),
      reason: "env",
      localAvatarUrl,
      hasPreparedAvatar: prepared
    };
  }
  if (mode === "solo") {
    return {
      provider: createStubProvider(),
      reason: "error-fallback",
      localAvatarUrl,
      hasPreparedAvatar: prepared
    };
  }
  throw new Error(
    `Unknown AVATAR_PROVIDER=${raw}. Supported: ${supportedProviders.join(", ")}`
  );
}
