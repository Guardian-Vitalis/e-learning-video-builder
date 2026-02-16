import { useEffect, useState } from "react";
import {
  PreviewGeneratorRuntimeConfig,
  fetchPreviewGeneratorRuntimeConfig
} from "../config/previewGeneratorConfig";

const DEFAULT_RUNTIME_CONFIG: PreviewGeneratorRuntimeConfig = {
  previewGeneratorBaseUrl: null,
  localAvatarEngineUrl: null,
  source: "unset"
};

export function useRuntimePreviewConfig() {
  const [runtimeConfig, setRuntimeConfig] = useState<PreviewGeneratorRuntimeConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchPreviewGeneratorRuntimeConfig();
        if (!cancelled) {
          setRuntimeConfig(config);
        }
      } catch {
        if (!cancelled) {
          setRuntimeConfig({ ...DEFAULT_RUNTIME_CONFIG, source: "error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return runtimeConfig ?? DEFAULT_RUNTIME_CONFIG;
}
