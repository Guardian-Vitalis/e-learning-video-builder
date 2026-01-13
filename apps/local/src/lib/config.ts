const DEFAULT_MAX_DOCX_MB = 300;
const DEFAULT_WARN_DOCX_MB = 120;

function parseEnvMb(value: string | undefined, fallbackMb: number): number {
  if (!value) {
    return fallbackMb;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMb;
  }
  return parsed;
}

function parseBytes(value: string | undefined, fallbackBytes: number): number {
  if (!value) {
    return fallbackBytes;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackBytes;
  }
  return parsed;
}

const maxBytesEnv = process.env.MAX_DOCX_BYTES ?? process.env.NEXT_PUBLIC_MAX_DOCX_BYTES;
const warnBytesEnv =
  process.env.LARGE_DOCX_WARN_BYTES ?? process.env.NEXT_PUBLIC_LARGE_DOCX_WARN_BYTES;
const maxBytes = parseBytes(maxBytesEnv, DEFAULT_MAX_DOCX_MB * 1024 * 1024);
const warnBytes = parseBytes(warnBytesEnv, DEFAULT_WARN_DOCX_MB * 1024 * 1024);
const maxMb = parseEnvMb(process.env.NEXT_PUBLIC_EVB_MAX_DOCX_MB, DEFAULT_MAX_DOCX_MB);
const warnMb = parseEnvMb(process.env.NEXT_PUBLIC_EVB_WARN_DOCX_MB, DEFAULT_WARN_DOCX_MB);

export const MAX_DOCX_BYTES = maxBytesEnv ? maxBytes : maxMb * 1024 * 1024;
export const LARGE_DOCX_WARN_BYTES = warnBytesEnv ? warnBytes : warnMb * 1024 * 1024;
