"use client";

import ScriptEditor from "../ScriptEditor";
import InlineErrorBlock from "../ui/InlineErrorBlock";
import SectionRenderPreview from "../Preview/SectionRenderPreview";
import type { CleanupResult, DraftSection } from "@evb/shared";


type Props = {
  section: DraftSection | null;
  onToggle: (sectionId: string, selected: boolean) => void;
  onToggleSubtree?: (sectionId: string, selected: boolean) => void;
  outlineDisabledIds?: string[];
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
    lastRenderedAt?: string | null;
    usesOverlay: boolean;
    mp4Url?: string;
    vttUrl?: string;
    srtUrl?: string;
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

function countSentences(text: string) {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return matches ? matches.length : 0;
}

export default function OutlineInspector({
  section,
  onToggle,
  onToggleSubtree,
  outlineDisabledIds,
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
  if (!section) {
    return <p className="text-sm text-slate-600">Select a section to inspect.</p>;
  }

  const preview = draftText.trim();
  const isEnabled = outlineDisabledIds?.includes(section.id) ? false : true;
  const wordCount = preview ? preview.split(/\s+/).filter(Boolean).length : 0;
  const sentenceCount = preview ? countSentences(preview) : 0;
  const clipCount =
    sentenceCount > 0
      ? Math.max(1, Math.ceil(sentenceCount / Math.max(1, sentencesPerClip)))
      : 1;
  const keyText = preview.length > 240 ? `${preview.slice(0, 240)}...` : preview;
  const hasSavedDraft = Boolean(scriptEditsByNodeId?.[section.id]);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{section.title}</p>
          <p className="text-xs text-slate-500">H{section.level}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(event) => onToggle(section.id, event.target.checked)}
            />
            Included
          </label>
          {onToggleSubtree && (
            <>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1"
                onClick={() => onToggleSubtree(section.id, true)}
              >
                Enable subtree
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 px-2 py-1"
                onClick={() => onToggleSubtree(section.id, false)}
              >
                Disable subtree
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>{preview.length} chars</span>
        <span>{wordCount} words</span>
        <span>{sentenceCount} sentences</span>
      </div>
      {keyText && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="text-xs font-medium text-slate-600">Key script text</p>
          <p className="mt-2 whitespace-pre-wrap">{keyText}</p>
        </div>
      )}
      <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <p className="text-xs font-medium text-slate-600">Clip plan summary</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <span>{clipCount} clip{clipCount === 1 ? "" : "s"}</span>
          <span>{variationsPerSection} variation{variationsPerSection === 1 ? "" : "s"}</span>
          <span>{sentencesPerClip} sentences/clip</span>
        </div>
      </div>
      {preview && (
        <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <summary className="cursor-pointer text-xs text-slate-500">
            Script preview
          </summary>
          <p className="mt-2 whitespace-pre-wrap">
            {preview.length > 400 ? `${preview.slice(0, 400)}...` : preview}
          </p>
        </details>
      )}
      {isDraftDirty && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Draft changes detected.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={isDraftSaving}
              onClick={() => onSaveDraft(draftText)}
            >
              {isDraftSaving ? "Saving..." : "Save Draft"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={isDraftSaving}
              onClick={() => {
                onDiscardDraft();
                onDraftTextChange(effectiveScript);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {regenerateError && (
        <div className="mt-3">
          <InlineErrorBlock message={regenerateError.message} details={regenerateError.details} />
        </div>
      )}
      {onRegenerateSection && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="text-xs font-medium text-slate-600">Regenerate section</p>
          <p className="mt-1 text-xs text-slate-500">
            Rebuilds clips for this section only.
          </p>
          <button
            type="button"
            className="btn-secondary mt-2"
            disabled={!canRegenerate || isRegenerating}
            onClick={() => onRegenerateSection(section.id)}
          >
            {isRegenerating ? "Starting..." : "Regenerate section"}
          </button>
          {!canRegenerate && regenerateHint && (
            <p className="mt-2 text-xs text-slate-500">{regenerateHint}</p>
          )}
        </div>
      )}
      {!isDraftDirty && hasSavedDraft && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p>Saved draft applied for this section.</p>
        </div>
      )}
      {previewClips && (
        <SectionRenderPreview
          clips={previewClips}
          previewJobId={previewJobId ?? null}
          previewCaptions={previewCaptions}
          onLoadPreviewCaption={onLoadPreviewCaption}
          localAvatarPreview={localAvatarPreview}
        />
      )}
      {scriptDiff && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          <p className="text-xs font-medium text-slate-600">Diff since last approve</p>
          {scriptDiff.status === "loading" && (
            <p className="mt-2 text-xs text-slate-500">Calculating...</p>
          )}
          {scriptDiff.status === "unavailable" && (
            <p className="mt-2 text-xs text-slate-500">Not approved yet.</p>
          )}
          {scriptDiff.status === "ready" && (
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              <p>
                Script changed since approval:{" "}
                <span className="font-medium">
                  {scriptDiff.scriptChanged ? "Yes" : "No"}
                </span>
              </p>
              <p>
                Changed sentences:{" "}
                <span className="font-medium">
                  {scriptDiff.changedSentences ?? "Unknown"}
                </span>
              </p>
            </div>
          )}
        </div>
      )}
      <ScriptEditor
        section={{ ...section, script: draftText }}
        onChange={(value) => onDraftTextChange(value)}
        onCommit={(value) => onDraftTextChange(value)}
        isSaving={isDraftSaving}
        cleanupEnabled={cleanupEnabled}
        cleanupResult={cleanupResult}
        cleanupMode={cleanupMode}
      />
    </div>
  );
}
