import type { ProjectGenerationHistoryItem } from "@evb/shared";

export function getExportJobIdFromHistory(
  history: ProjectGenerationHistoryItem[] | undefined,
  selectedPreviewJobId: string | null
): string | null {
  const items = history ?? [];
  if (selectedPreviewJobId) {
    const selected = items.find(
      (item) => item.jobId === selectedPreviewJobId && item.status === "succeeded"
    );
    if (selected) {
      return selected.jobId;
    }
  }
  const fallback = items.find((item) => item.status === "succeeded");
  return fallback?.jobId ?? null;
}
