import { createHmac, timingSafeEqual } from "crypto";

type TokenPayload = { jobId: string; exp: number; path?: string };

function base64UrlEncode(input: Buffer | string) {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function getTokenSecret() {
  return process.env.ARTIFACT_TOKEN_SECRET ?? "dev-secret";
}

function getTokenTtlSeconds() {
  const raw = Number(process.env.ARTIFACT_TOKEN_TTL_SECONDS);
  return Number.isFinite(raw) ? raw : 300;
}

function signPayload(payload: string, secret: string) {
  return base64UrlEncode(createHmac("sha256", secret).update(payload).digest());
}

function isSafeRelativePath(value: string) {
  if (!value || value.startsWith("/") || value.startsWith("\\")) {
    return false;
  }
  if (value.includes("..") || value.includes("\\")) {
    return false;
  }
  const parts = value.split("/");
  return !parts.some((part) => part === "" || part === "." || part === "..");
}

export function createArtifactToken(
  jobId: string,
  options?: { secret?: string; ttlSeconds?: number; path?: string }
) {
  const secret = options?.secret ?? getTokenSecret();
  const ttl = Math.max(1, options?.ttlSeconds ?? getTokenTtlSeconds());
  const exp = Math.floor(Date.now() / 1000) + ttl;
  if (options?.path && !isSafeRelativePath(options.path)) {
    throw new Error("Unsafe artifact path.");
  }
  const payload = JSON.stringify(
    options?.path ? { jobId, exp, path: options.path } : { jobId, exp }
  );
  const token = `${base64UrlEncode(payload)}.${signPayload(payload, secret)}`;
  return { token, exp };
}

export function validateArtifactToken(
  token: string,
  jobId: string,
  options?: { secret?: string; path?: string }
) {
  const secret = options?.secret ?? getTokenSecret();
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, expired: false };
  }
  const [encodedPayload, signature] = parts;
  let payload: TokenPayload;
  try {
    const decoded = base64UrlDecode(encodedPayload).toString("utf8");
    payload = JSON.parse(decoded) as TokenPayload;
  } catch {
    return { ok: false, expired: false };
  }
  if (!payload?.jobId || typeof payload.exp !== "number" || payload.jobId !== jobId) {
    return { ok: false, expired: false };
  }
  if (options?.path && payload.path !== options.path) {
    return { ok: false, expired: false };
  }
  if (payload.path && !isSafeRelativePath(payload.path)) {
    return { ok: false, expired: false };
  }
  const expectedPayload = payload.path
    ? { jobId: payload.jobId, exp: payload.exp, path: payload.path }
    : { jobId: payload.jobId, exp: payload.exp };
  const expected = signPayload(JSON.stringify(expectedPayload), secret);
  if (signature.length !== expected.length) {
    return { ok: false, expired: false };
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false, expired: false };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { ok: false, expired: true };
  }
  return { ok: true, expired: false };
}

export function parseArtifactToken(token: string, options?: { secret?: string }) {
  const secret = options?.secret ?? getTokenSecret();
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, expired: false };
  }
  const [encodedPayload, signature] = parts;
  let payload: TokenPayload;
  try {
    const decoded = base64UrlDecode(encodedPayload).toString("utf8");
    payload = JSON.parse(decoded) as TokenPayload;
  } catch {
    return { ok: false, expired: false };
  }
  if (!payload?.jobId || typeof payload.exp !== "number") {
    return { ok: false, expired: false };
  }
  if (payload.path && !isSafeRelativePath(payload.path)) {
    return { ok: false, expired: false };
  }
  const expectedPayload = payload.path
    ? { jobId: payload.jobId, exp: payload.exp, path: payload.path }
    : { jobId: payload.jobId, exp: payload.exp };
  const expected = signPayload(JSON.stringify(expectedPayload), secret);
  if (signature.length !== expected.length) {
    return { ok: false, expired: false };
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false, expired: false };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return { ok: false, expired: true };
  }
  return { ok: true, expired: false, payload };
}
