import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function buildPrepKey({
  avatarId,
  imagePngBase64,
  fps,
  bboxShift
}) {
  let identity = "anon";
  if (avatarId && avatarId.trim().length > 0) {
    identity = `avatar:${avatarId.trim()}`;
  } else if (imagePngBase64) {
    const buffer = Buffer.from(imagePngBase64, "base64");
    identity = `image:${sha256Hex(buffer)}`;
  }
  const fpsPart = Number.isFinite(fps) ? String(fps) : "na";
  const bboxPart = Number.isFinite(bboxShift) ? String(bboxShift) : "na";
  return `${identity}:${fpsPart}:${bboxPart}`;
}

export class PrepCache {
  constructor(options) {
    this.cacheDir = options.cacheDir;
    this.entries = new Map();
    this.inFlight = new Map();
  }

  getEntry(key) {
    return this.entries.get(key);
  }

  has(key) {
    return this.entries.has(key);
  }

  getSummary({ includeKeys = false } = {}) {
    const keys = Array.from(this.entries.keys());
    const lastPrepAtByKey = {};
    for (const [key, entry] of this.entries.entries()) {
      lastPrepAtByKey[key] = entry.createdAt;
    }
    return {
      preparedAvatars: this.entries.size,
      ...(includeKeys ? { keys } : {}),
      ...(includeKeys ? { lastPrepAtByKey } : {})
    };
  }

  recordEntry({ key, preparedDir, fps, bboxShift }) {
    const now = new Date().toISOString();
    const entry = this.entries.get(key);
    const next = {
      preparedDir,
      createdAt: entry?.createdAt ?? now,
      lastUsedAt: now,
      fps,
      bboxShift
    };
    this.entries.set(key, next);
    return next;
  }

  async getOrPrepare({ key, fps, bboxShift, force = false, prepareFn }) {
    if (!force && this.entries.has(key)) {
      const cached = this.entries.get(key);
      cached.lastUsedAt = new Date().toISOString();
      return { entry: cached, cacheHit: true };
    }
    if (!force && this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }
    const promise = this.prepareEntry({ key, fps, bboxShift, prepareFn });
    this.inFlight.set(key, promise);
    try {
      const entry = await promise;
      return { entry, cacheHit: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  async prepareEntry({ key, fps, bboxShift, prepareFn }) {
    const preparedDir = path.join(this.cacheDir, key.replace(/[:]/g, "_"));
    await fs.mkdir(preparedDir, { recursive: true });
    if (prepareFn) {
      await prepareFn({ preparedDir, fps, bboxShift });
    }
    const now = new Date().toISOString();
    const entry = {
      preparedDir,
      createdAt: now,
      lastUsedAt: now,
      fps,
      bboxShift
    };
    this.entries.set(key, entry);
    return { entry, cacheHit: false };
  }
}
