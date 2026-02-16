import { getRunMode, isRedisEnabled } from "./config";

export function isNoRedisDevMode() {
  return !isRedisEnabled();
}

export function getDevModeLabel() {
  return getRunMode();
}

export function isSoloMode() {
  return getRunMode() === "solo";
}
