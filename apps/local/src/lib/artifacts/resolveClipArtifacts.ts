type ResolveClipArtifactsArgs = {
  baseUrl?: string;
  jobId: string;
  sectionId: string;
  clipId: string;
  mp4Path?: string;
  vttPath?: string;
  srtPath?: string;
};

function resolveUrl(baseUrl: string | undefined, relPath: string) {
  if (!baseUrl) {
    return relPath;
  }
  if (relPath.startsWith("http")) {
    return relPath;
  }
  return `${baseUrl}${relPath}`;
}

function buildDeterministicPaths(jobId: string, sectionId: string, clipId: string) {
  const match = /(.*)-v(\d+)-c(\d+)$/.exec(clipId);
  if (!match) {
    return null;
  }
  const variationIndex = Number(match[2]);
  const clipIndex = Number(match[3]);
  if (!Number.isInteger(variationIndex) || !Number.isInteger(clipIndex)) {
    return null;
  }
  const baseDir = [jobId, "sections", sectionId, `v${variationIndex}`].join("/");
  const baseName = `clip-${clipIndex}`;
  return {
    mp4Path: `${baseDir}/${baseName}.mp4`,
    vttPath: `${baseDir}/${baseName}.vtt`,
    srtPath: `${baseDir}/${baseName}.srt`
  };
}

export function resolveClipArtifacts(args: ResolveClipArtifactsArgs) {
  const { baseUrl, jobId, sectionId, clipId, mp4Path, vttPath, srtPath } = args;
  const fallback = buildDeterministicPaths(jobId, sectionId, clipId);
  const resolvedMp4 = mp4Path ?? fallback?.mp4Path;
  const resolvedVtt = vttPath ?? fallback?.vttPath;
  const resolvedSrt = srtPath ?? fallback?.srtPath;
  return {
    mp4Path: resolvedMp4,
    vttPath: resolvedVtt,
    srtPath: resolvedSrt,
    mp4Url: resolvedMp4 ? resolveUrl(baseUrl, resolvedMp4) : undefined,
    vttUrl: resolvedVtt ? resolveUrl(baseUrl, resolvedVtt) : undefined,
    srtUrl: resolvedSrt ? resolveUrl(baseUrl, resolvedSrt) : undefined
  };
}
