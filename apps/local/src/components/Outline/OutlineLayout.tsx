"use client";

import { useMemo } from "react";
import type { CleanupResult, DraftSection } from "@evb/shared";
import OutlineTree from "./OutlineTree";
import OutlineSearch from "./OutlineSearch";
import OutlineInspector from "./OutlineInspector";
import { buildOutlineView } from "../../lib/outline/outlineSelectors";
import { filterOutlineNodes } from "../../lib/outline/outlineFilter";
import { useOutlineStore } from "../../state/outlineStore";

function isSectionEnabled(
  section: DraftSection,
  outlineDisabledIds?: string[]
) {
  if (outlineDisabledIds && outlineDisabledIds.includes(section.id)) {
    return false;
  }
  return true;
}

function buildSelectedSet(
  sections: DraftSection[],
  outlineDisabledIds?: string[]
) {
  return new Set(
    sections.filter((section) => isSectionEnabled(section, outlineDisabledIds)).map((section) => section.id)
  );
}

type Props = {
  sections: DraftSection[];
  outlineDisabledIds?: string[];
  selectedSectionId: string | null;
  onSelect: (sectionId: string) => void;
  onToggle: (sectionId: string, selected: boolean) => void;
  onToggleSubtree?: (sectionId: string, selected: boolean) => void;
  sentencesPerClip: number;
  variationsPerSection: number;
  scriptEditsByNodeId?: Record<string, string>;
  draftText: string;
  onDraftTextChange: (value: string) => void;
  effectiveScript: string;
  onSaveDraft: (text: string) => void;
  onDiscardDraft: () => void;
  isDraftDirty: boolean;
  isDraftSaving: boolean;
  cleanupEnabled: boolean;
  cleanupResult?: CleanupResult;
  cleanupMode: "off" | "deterministic" | "llm";
  canRegenerate?: boolean;
  regenerateHint?: string;
  onRegenerateSection?: (sectionId: string) => void;
  isRegenerating?: boolean;
  regenerateError?: { message: string; details?: string | null };
  previewClips?: Array<{
    id: string;
    index: number;
    mp4Url?: string;
    vttUrl?: string;
    srtUrl?: string;
    lastRenderedAt?: string | null;
    usesOverlay: boolean;
  }>;
  previewJobId?: string | null;
  previewCaptions?: Record<
    string,
    { status: "idle" | "loading" | "loaded" | "error"; text?: string; error?: string }
  >;
  onLoadPreviewCaption?: (clipId: string, url: string) => void;
  localAvatarPreview?: {
    config?: { avatarId: string; fps: number; bboxShift: number } | null;
    refImageDataUrl?: string | null;
    hint?: string | null;
  };
  scriptDiff?: {
    status: "loading" | "ready" | "unavailable";
    scriptChanged: boolean | null;
    changedSentences: number | null;
  };
};

export default function OutlineLayout({
  sections,
  outlineDisabledIds,
  selectedSectionId,
  onSelect,
  onToggle,
  onToggleSubtree,
  sentencesPerClip,
  variationsPerSection,
  scriptEditsByNodeId,
  draftText,
  onDraftTextChange,
  effectiveScript,
  onSaveDraft,
  onDiscardDraft,
  isDraftDirty,
  isDraftSaving,
  cleanupEnabled,
  cleanupResult,
  cleanupMode,
  canRegenerate,
  regenerateHint,
  onRegenerateSection,
  isRegenerating,
  regenerateError,
  previewClips,
  previewJobId,
  previewCaptions,
  onLoadPreviewCaption,
  localAvatarPreview,
  scriptDiff
}: Props) {
  // UI-only view; uses deterministic IDs and never mutates sections.
  const { nodes } = useMemo(() => buildOutlineView(sections, new Set()), [sections]);
  const {
    query,
    setQuery,
    selectedOnly,
    setSelectedOnly,
    collapsedIds,
    toggleCollapsed,
    expandAll,
    collapseAll
  } = useOutlineStore(nodes, { defaultCollapsedDepth: 2 });
  const { nodes: nodesWithCollapse, parentMap: mapWithCollapse } = useMemo(
    () => buildOutlineView(sections, collapsedIds),
    [sections, collapsedIds]
  );
  const filterResult = useMemo(
    () =>
      filterOutlineNodes({
        nodes: nodesWithCollapse,
        sections,
        outlineDisabledIds,
        filter: { query, selectedOnly },
        parentMap: mapWithCollapse
      }),
    [nodesWithCollapse, sections, outlineDisabledIds, query, selectedOnly, mapWithCollapse]
  );

  const selectedSection =
    sections.find((section) => section.id === selectedSectionId) ?? null;
  const selectedIds = useMemo(
    () => buildSelectedSet(sections, outlineDisabledIds),
    [sections, outlineDisabledIds]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <section className="card space-y-3">
        <div>
          <h2>Outline</h2>
          <p className="text-xs text-slate-500">
            Search and expand sections without losing your place.
          </p>
        </div>
        <OutlineSearch
          query={query}
          selectedOnly={selectedOnly}
          onQueryChange={setQuery}
          onSelectedOnlyChange={setSelectedOnly}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
        />
        <OutlineTree
          nodes={filterResult.visible}
          selectedSectionId={selectedSectionId}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onToggle={onToggle}
          onToggleSubtree={onToggleSubtree}
          onToggleExpand={toggleCollapsed}
        />
      </section>
      <section className="card space-y-3">
        <div>
          <h2>Selected node</h2>
          <p className="text-xs text-slate-500">
            Inspect a section without losing your outline context.
          </p>
        </div>
        <OutlineInspector
          section={selectedSection}
          onToggle={onToggle}
          onToggleSubtree={onToggleSubtree}
          outlineDisabledIds={outlineDisabledIds}
          sentencesPerClip={sentencesPerClip}
          variationsPerSection={variationsPerSection}
          scriptEditsByNodeId={scriptEditsByNodeId}
          draftText={draftText}
          onDraftTextChange={onDraftTextChange}
          effectiveScript={effectiveScript}
          onSaveDraft={onSaveDraft}
          onDiscardDraft={onDiscardDraft}
          isDraftDirty={isDraftDirty}
          isDraftSaving={isDraftSaving}
          cleanupEnabled={cleanupEnabled}
          cleanupResult={cleanupResult}
          cleanupMode={cleanupMode}
          canRegenerate={canRegenerate}
          regenerateHint={regenerateHint}
          onRegenerateSection={onRegenerateSection}
          isRegenerating={isRegenerating}
          regenerateError={regenerateError}
          previewClips={previewClips}
          previewJobId={previewJobId}
          previewCaptions={previewCaptions}
          onLoadPreviewCaption={onLoadPreviewCaption}
          localAvatarPreview={localAvatarPreview}
          scriptDiff={scriptDiff}
        />
      </section>
    </div>
  );
}
