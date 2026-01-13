"use client";

import { DraftSection } from "@evb/shared";

type Props = {
  sections: DraftSection[];
  selectedSectionId: string | null;
  onSelect: (sectionId: string) => void;
  onToggle: (sectionId: string, selected: boolean) => void;
};

export default function OutlinePanel({
  sections,
  selectedSectionId,
  onSelect,
  onToggle
}: Props) {
  return (
    <section className="card space-y-3">
      <h2>Outline</h2>
      <ul className="space-y-2">
        {sections.map((section) => {
          const preview = section.script.trim();
          const previewText =
            preview.length > 200 ? `${preview.slice(0, 200)}...` : preview;
          const paragraphCount = preview
            ? preview.split(/\n+/).filter(Boolean).length
            : 0;
          const indent = Math.max(0, Math.min(section.level, 3) - 1) * 12;
          return (
            <li key={section.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(section.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelect(section.id);
                  }
                }}
                aria-pressed={selectedSectionId === section.id}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  selectedSectionId === section.id
                    ? "border-slate-300 bg-slate-100"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
                style={{ paddingLeft: 12 + indent }}
              >
                <input
                  type="checkbox"
                  checked={section.selected}
                  onChange={(event) => onToggle(section.id, event.target.checked)}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="flex-1 text-slate-800">{section.title}</span>
                <span className="text-xs text-slate-500">
                  {section.level > 0 ? `H${section.level}` : "P"}
                </span>
                {selectedSectionId === section.id && (
                  <span className="text-xs text-slate-500">(editing)</span>
                )}
              </div>
              {preview && (
                <details className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    Preview ({paragraphCount} paragraph{paragraphCount === 1 ? "" : "s"})
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap">{previewText}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
