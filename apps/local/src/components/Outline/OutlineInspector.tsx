"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ScriptEditor from "../ScriptEditor";
import InlineErrorBlock from "../ui/InlineErrorBlock";
import SectionRenderPreview from "../Preview/SectionRenderPreview";
import type { CleanupResult, DraftSection } from "@evb/shared";
import { getCloudApiBaseUrl } from "../../api/cloud";


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

const MAX_STATS_CHARS = 200000;
const PREVIEW_LINE_LIMIT = 80;
const PREVIEW_CHAR_LIMIT = 12000;

function getScriptStats(text: string) {
  const limit = Math.min(text.length, MAX_STATS_CHARS);
  let words = 0;
  let sentences = 0;
  let inWord = false;
  for (let i = 0; i < limit; i += 1) {
    const ch = text[i];
    const isWhitespace =
      ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";
    if (!isWhitespace && !inWord) {
      words += 1;
      inWord = true;
    }
    if (isWhitespace) {
      inWord = false;
    }
    if (ch === "." || ch === "!" || ch === "?") {
      sentences += 1;
    }
  }
  const truncated = text.length > MAX_STATS_CHARS;
  return { words, sentences, truncated };
}

function buildLinePreview(text: string) {
  if (!text) {
    return { preview: "", truncated: false };
  }
  let lines = 1;
  let endIndex = 0;
  for (let i = 0; i < text.length && i < PREVIEW_CHAR_LIMIT; i += 1) {
    if (text[i] === "\n") {
      lines += 1;
      if (lines > PREVIEW_LINE_LIMIT) {
        endIndex = i;
        break;
      }
    }
    endIndex = i + 1;
  }
  const truncated =
    endIndex < text.length && (lines > PREVIEW_LINE_LIMIT || endIndex >= PREVIEW_CHAR_LIMIT);
  return { preview: text.slice(0, endIndex), truncated };
}

function formatCount(value: number, truncated: boolean) {
  return truncated ? `${value}+` : String(value);
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
  const params = useParams<{ id: string }>();
  const [showDetails, setShowDetails] = useState(false);
  const [showFullScript, setShowFullScript] = useState(false);
  const [fullScriptLoading, setFullScriptLoading] = useState(false);
  const [fullScriptLoaded, setFullScriptLoaded] = useState(false);
  const [fullScriptError, setFullScriptError] = useState<string | null>(null);
  const preview = draftText;
  const stats = useMemo(() => getScriptStats(preview), [preview]);
  const scriptPreview = useMemo(() => buildLinePreview(preview), [preview]);
  const shouldAutoShowFull = !scriptPreview.truncated;
  const hasSavedDraft = Boolean(scriptEditsByNodeId?.[section?.id ?? ""]);

  useEffect(() => {
    setShowDetails(false);
    setShowFullScript(shouldAutoShowFull);
    setFullScriptLoading(false);
    setFullScriptLoaded(hasSavedDraft);
    setFullScriptError(null);
  }, [section?.id, shouldAutoShowFull, hasSavedDraft]);

  if (!section) {
    return <p className="text-sm text-slate-600">Select a section to inspect.</p>;
  }

  const isEnabled = outlineDisabledIds?.includes(section.id) ? false : true;
  const clipCount =
    stats.sentences > 0
      ? Math.max(1, Math.ceil(stats.sentences / Math.max(1, sentencesPerClip)))
      : 1;
  const keyText = preview.length > 240 ? `${preview.slice(0, 240)}...` : preview;
  const loadFullScript = async () => {
    if (!section || fullScriptLoading || fullScriptLoaded || hasSavedDraft) {
      return;
    }
    setFullScriptLoading(true);
    setFullScriptError(null);
    try {
      const baseUrl = getCloudApiBaseUrl();
      const projectId = params?.id ?? "";
      if (!projectId) {
        throw new Error("missing_project_id");
      }
      const url = `${baseUrl}/v1/import/projects/${projectId}/sections/${section.id}/script`;
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `status ${res.status}`);
      }
      const data = (text ? JSON.parse(text) : {}) as { text?: string };
      const fullScript = data.text ?? "";
      if (!fullScript) {
        throw new Error("empty_script");
      }
      setFullScriptLoaded(true);
      if (fullScript !== draftText) {
        onSaveDraft(fullScript);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFullScriptError(message);
    } finally {
      setFullScriptLoading(false);
    }
  };



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
        <span>{formatCount(stats.words, stats.truncated)} words</span>
        <span>{formatCount(stats.sentences, stats.truncated)} sentences</span>
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
        <details
          className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
          open={showDetails}
          onToggle={(event) => setShowDetails(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-xs text-slate-500">
            Section details (lazy render)
          </summary>
          {showDetails && (
            <>
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-600">
                  Script preview (first {PREVIEW_LINE_LIMIT} lines)
                </p>
                <p className="mt-2 whitespace-pre-wrap">
                  {scriptPreview.preview}
                  {scriptPreview.truncated ? "..." : ""}
                </p>
                {!showFullScript && scriptPreview.truncated && (
                  <button
                    type="button"
                    className="btn-ghost mt-2"
                    onClick={() => {
                      setShowFullScript(true);
                      void loadFullScript();
                    }}
                    disabled={fullScriptLoading}
                  >
                    {fullScriptLoading ? "Loading full script..." : "Show full script editor"}
                  </button>
                )}
              </div>
              {fullScriptError && (
                <div className="mt-2">
                  <InlineErrorBlock
                    message="Unable to load full script."
                    details={fullScriptError}
                  />
                </div>
              )}
              {showFullScript && (!scriptPreview.truncated || fullScriptLoaded || hasSavedDraft) && (
                <ScriptEditor
                  section={{ ...section, script: draftText }}
                  onChange={(value) => onDraftTextChange(value)}
                  onCommit={(value) => onDraftTextChange(value)}
                  isSaving={isDraftSaving}
                  cleanupEnabled={cleanupEnabled}
                  cleanupResult={cleanupResult}
                  cleanupMode={cleanupMode}
                />
              )}
            </>
          )}
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
      {showDetails && previewClips && (
        <SectionRenderPreview
          clips={previewClips}
          previewJobId={previewJobId ?? null}
          previewCaptions={previewCaptions}
          onLoadPreviewCaption={onLoadPreviewCaption}
          localAvatarPreview={localAvatarPreview}
        />
      )}
      {showDetails && scriptDiff && (
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
    </div>
  );
}
