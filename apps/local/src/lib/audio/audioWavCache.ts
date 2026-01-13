type CachedWav = {
  wavBase64: string;
  sourceKey: string;
  createdAt: number;
};

const cache = new Map<string, CachedWav>();

export function getCachedWav(clipId: string, sourceKey: string): string | null {
  const entry = cache.get(clipId);
  if (!entry) {
    return null;
  }
  if (entry.sourceKey !== sourceKey) {
    return null;
  }
  return entry.wavBase64;
}

export function setCachedWav(clipId: string, sourceKey: string, wavBase64: string) {
  cache.set(clipId, { wavBase64, sourceKey, createdAt: Date.now() });
}

export function clearCachedWav(clipId?: string) {
  if (!clipId) {
    cache.clear();
    return;
  }
  cache.delete(clipId);
}
