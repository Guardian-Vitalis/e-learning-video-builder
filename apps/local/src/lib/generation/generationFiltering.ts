import type { DraftManifest } from "@evb/shared";

export function filterDraftManifestSections(
  manifest: DraftManifest,
  outlineDisabledIds?: string[]
): DraftManifest["sections"] {
  if (!outlineDisabledIds || outlineDisabledIds.length === 0) {
    return manifest.sections.slice();
  }
  const disabledSet = new Set(outlineDisabledIds);
  return manifest.sections.filter((section) => !disabledSet.has(section.id));
}
