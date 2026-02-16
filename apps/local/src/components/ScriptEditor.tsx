"use client";

import { useEffect, useState } from "react";
import { CleanupResult, DraftSection } from "@evb/shared";
import { getTableImage } from "../lib/storage/tableImageStore";
import SaveStatus from "./ui/SaveStatus";

type Props = {
  section: DraftSection | null;
  onChange?: (value: string) => void;
  onCommit?: (value: string) => void;
  isSaving: boolean;
  cleanupEnabled?: boolean;
  cleanupResult?: CleanupResult;
  cleanupMode?: "off" | "deterministic" | "llm";
  readOnly?: boolean;
};

export default function ScriptEditor({
  section,
  onChange,
  onCommit,
  isSaving,
  cleanupEnabled,
  cleanupResult,
  cleanupMode,
  readOnly
}: Props) {
  const [draft, setDraft] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(section?.script ?? "");
  }, [section?.id, section?.script]);

  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};
    const loadImages = async () => {
      if (!section?.tableImages || section.tableImages.length === 0) {
        setImageUrls({});
        setImageError(null);
        return;
      }
      try {
        for (const attachment of section.tableImages) {
          const blob = await getTableImage(attachment.id);
          if (!blob) {
            continue;
          }
          urls[attachment.id] = URL.createObjectURL(blob);
        }
        if (!cancelled) {
          setImageUrls(urls);
          setImageError(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          setImageError(message);
          setImageUrls({});
        }
      }
    };

    loadImages();

    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [section?.id, section?.tableImages]);

  if (!section) {
    return (
      <section className="card space-y-2">
        <h2>Script</h2>
        <p>Select a section to view its script.</p>
      </section>
    );
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2>Script</h2>
          <h3 className="mt-1 text-sm font-medium text-slate-600">
            {section.title}
          </h3>
        </div>
        {!readOnly && <SaveStatus state={isSaving ? "saving" : "saved"} />}
      </div>
      <textarea
        value={draft}
        onChange={(event) => {
          if (readOnly) {
            return;
          }
          const value = event.target.value;
          setDraft(value);
          onChange?.(value);
        }}
        onBlur={() => {
          if (readOnly) {
            return;
          }
          onCommit?.(draft);
        }}
        rows={16}
        className="min-h-[280px]"
        readOnly={readOnly}
      />
      {readOnly && (
        <p className="text-xs text-slate-500">Read-only in this view.</p>
      )}
      <p className="text-xs text-slate-500">{draft.length} characters</p>
      {cleanupEnabled && cleanupResult && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="font-medium text-slate-800">Source text</p>
              <p className="mt-2 whitespace-pre-wrap">{section.script}</p>
            </div>
            <div>
              <p className="font-medium text-slate-800">Cleaned narration</p>
              <p className="mt-2 whitespace-pre-wrap">{cleanupResult.cleanedText}</p>
            </div>
          </div>
          {cleanupMode === "llm" && (
            <p className="mt-2 text-xs text-slate-600">
              Note: LLM cleanup runs on Cloud at generation time. Preview uses deterministic cleanup.
            </p>
          )}
          {cleanupResult.warnings.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Warnings: {cleanupResult.warnings.join(", ")}
            </p>
          )}
        </div>
      )}
      {section.tableImages && section.tableImages.length > 0 && (
        <div className="space-y-3">
          <h3>Table Images</h3>
          {imageError && (
            <p className="text-xs text-red-600">Image unavailable. Re-upload the DOCX.</p>
          )}
          {section.tableImages.map((attachment) => (
            <div key={attachment.id} className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-slate-600">{attachment.anchorText}</p>
              {imageUrls[attachment.id] ? (
                <img
                  src={imageUrls[attachment.id]}
                  alt={attachment.anchorText}
                  className="mt-2 max-h-60 rounded-md border border-slate-200 object-contain"
                />
              ) : (
                <p className="mt-2 text-xs text-slate-500">Image unavailable.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
