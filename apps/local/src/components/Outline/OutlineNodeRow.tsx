"use client";

import type { OutlineNodeVM } from "../../lib/outline/outlineSelectors";

const INDENT = 14;

function getIndent(depth: number) {
  return Math.max(0, depth - 1) * INDENT;
}

type Props = {
  node: OutlineNodeVM;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (sectionId: string) => void;
  onToggle: (sectionId: string, selected: boolean) => void;
  onToggleSubtree?: (sectionId: string, selected: boolean) => void;
  onToggleExpand: (sectionId: string) => void;
};

export default function OutlineNodeRow({
  node,
  isSelected,
  isChecked,
  onSelect,
  onToggle,
  onToggleSubtree,
  onToggleExpand
}: Props) {
  const isExpanded = node.hasChildren && !node.isCollapsed;
  return (
    <div
      className={`flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm transition ${
        isSelected ? "bg-slate-100" : "bg-white hover:bg-slate-50"
      }`}
      style={{ paddingLeft: 12 + getIndent(node.depth) }}
    >
      {node.hasChildren ? (
        <button
          type="button"
          className="h-6 w-6 rounded-md border border-slate-200 text-xs text-slate-600"
          onClick={() => onToggleExpand(node.id)}
          aria-label={isExpanded ? "Collapse section" : "Expand section"}
        >
          {isExpanded ? "v" : ">"}
        </button>
      ) : (
        <span className="h-6 w-6" />
      )}
      <input
        type="checkbox"
        checked={isChecked}
        onChange={(event) => onToggle(node.id, event.target.checked)}
        onClick={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        className="flex-1 text-left text-slate-800"
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            onSelect(node.id);
          }
        }}
      >
        <span className="block truncate">{node.title}</span>
      </button>
      {node.hasChildren && onToggleSubtree && (
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <button
            type="button"
            className="rounded-md border border-slate-200 px-2 py-1"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSubtree(node.id, true);
            }}
          >
            Enable subtree
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-2 py-1"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSubtree(node.id, false);
            }}
          >
            Disable subtree
          </button>
        </div>
      )}
      <span className="text-xs text-slate-500">H{node.depth}</span>
    </div>
  );
}
