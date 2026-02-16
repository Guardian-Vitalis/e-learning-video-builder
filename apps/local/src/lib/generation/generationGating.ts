import type { DraftManifest, DocxSourceDoc } from "@evb/shared";
import { getEffectiveScriptForNode } from "../script/effectiveScript";
import { filterDraftManifestSections } from "./generationFiltering";

export type GenerationInputFromDraft = {
  sourceDoc: DocxSourceDoc;
  selectedSectionIds: string[];
};

export function buildGenerationInputFromDraft(
  draftManifest: DraftManifest,
  outlineDisabledIds?: string[],
  scriptEditsByNodeId?: Record<string, string>
): GenerationInputFromDraft {
  const enabledSections = filterDraftManifestSections(draftManifest, outlineDisabledIds);
  const selectedSectionIds = enabledSections.map((section) => section.id);
  return {
    sourceDoc: {
      title: draftManifest.courseTitle,
      sections: enabledSections.map((section) => ({
        sectionId: section.id,
        level: section.level === 2 || section.level === 3 ? section.level : 1,
        heading: section.title,
        text: getEffectiveScriptForNode({
          nodeId: section.id,
          baseScript: section.script,
          scriptEditsByNodeId
        })
      }))
    },
    selectedSectionIds
  };
}
