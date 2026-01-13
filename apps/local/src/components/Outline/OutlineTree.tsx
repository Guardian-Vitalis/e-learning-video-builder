"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import OutlineNodeRow from "./OutlineNodeRow";
import type { OutlineNodeVM } from "../../lib/outline/outlineSelectors";

type Props = {
  nodes: OutlineNodeVM[];
  selectedSectionId: string | null;
  selectedIds: Set<string>;
  onSelect: (sectionId: string) => void;
  onToggle: (sectionId: string, selected: boolean) => void;
  onToggleSubtree?: (sectionId: string, selected: boolean) => void;
  onToggleExpand: (sectionId: string) => void;
};

const ROW_HEIGHT = 48;
const OVERSCAN = 6;

export default function OutlineTree({
  nodes,
  selectedSectionId,
  selectedIds,
  onSelect,
  onToggle,
  onToggleSubtree,
  onToggleExpand
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(400);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setViewportHeight(containerRef.current.clientHeight || 400);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const totalHeight = nodes.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    nodes.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );

  const visibleNodes = useMemo(
    () => nodes.slice(startIndex, endIndex),
    [nodes, startIndex, endIndex]
  );

  return (
    <div
      ref={containerRef}
      className="h-[520px] max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-white"
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop);
      }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: startIndex * ROW_HEIGHT,
            left: 0,
            right: 0
          }}
        >
          {visibleNodes.map((node) => (
            <OutlineNodeRow
              key={node.id}
              node={node}
              isSelected={selectedSectionId === node.id}
              isChecked={selectedIds.has(node.id)}
              onSelect={onSelect}
              onToggle={onToggle}
              onToggleSubtree={onToggleSubtree}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
