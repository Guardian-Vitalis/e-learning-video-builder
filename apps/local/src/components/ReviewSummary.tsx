"use client";

import { useState } from "react";
import { DraftManifest } from "@evb/shared";

type Props = {
  manifest: DraftManifest;
  courseTitle: string;
  outlineDisabledIds?: string[];
};

function isSectionEnabled(
  section: DraftManifest["sections"][number],
  outlineDisabledIds?: string[]
) {
  if (outlineDisabledIds && outlineDisabledIds.includes(section.id)) {
    return false;
  }
  return true;
}

export default function ReviewSummary({
  manifest,
  courseTitle,
  outlineDisabledIds
}: Props) {
  const selectedSections = manifest.sections.filter((section) =>
    isSectionEnabled(section, outlineDisabledIds)
  );

  return (
    <section className="card space-y-3">
      <h2>Review Summary</h2>
      <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
        <p>Course title: {courseTitle}</p>
        <p>Sections: {manifest.sections.length}</p>
        <p>Selected sections: {selectedSections.length}</p>
      </div>
      <ul className="space-y-3">
        {selectedSections.map((section) => (
          <ReviewSection key={section.id} title={section.title} script={section.script} />
        ))}
      </ul>
    </section>
  );
}

function ReviewSection({ title, script }: { title: string; script: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = script.slice(0, 300);
  const needsToggle = script.length > 300;

  return (
    <li className="rounded-md border border-slate-200 p-3">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-2 text-sm text-slate-700">
        {expanded || !needsToggle ? script : `${preview}...`}
      </p>
      {needsToggle && (
        <button type="button" className="btn-ghost mt-2" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </li>
  );
}
