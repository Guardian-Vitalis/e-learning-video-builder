import type { DraftSection } from "@evb/shared";

export type OutlineNodeVM = {
  id: string;
  title: string;
  depth: number;
  parentId?: string;
  hasChildren: boolean;
  isCollapsed: boolean;
};

const MAX_DEPTH = 3;

function clampDepth(value: number) {
  return Math.max(1, Math.min(value, MAX_DEPTH));
}

// UI-only view model; deterministic IDs are passed through unchanged.
export function buildOutlineView(
  sections: DraftSection[],
  collapsedIds: Set<string>
): { nodes: OutlineNodeVM[]; parentMap: Map<string, string | undefined> } {
  const nodes: OutlineNodeVM[] = [];
  const parentMap = new Map<string, string | undefined>();
  const stack: Array<{ id: string; depth: number }> = [];

  sections.forEach((section, index) => {
    const depth = clampDepth(section.level);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parentId = stack.length > 0 ? stack[stack.length - 1].id : undefined;
    const next = sections[index + 1];
    const hasChildren = Boolean(next && clampDepth(next.level) > depth);

    nodes.push({
      id: section.id,
      title: section.title,
      depth,
      parentId,
      hasChildren,
      isCollapsed: collapsedIds.has(section.id)
    });
    parentMap.set(section.id, parentId);
    stack.push({ id: section.id, depth });
  });

  return { nodes, parentMap };
}
