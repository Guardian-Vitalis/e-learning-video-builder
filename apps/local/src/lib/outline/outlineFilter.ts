import type { DraftSection } from "@evb/shared";
import type { OutlineNodeVM } from "./outlineSelectors";

export type OutlineFilterState = {
  query: string;
  selectedOnly: boolean;
};

function isSectionEnabled(
  section: DraftSection,
  outlineDisabledIds?: string[]
) {
  if (outlineDisabledIds && outlineDisabledIds.includes(section.id)) {
    return false;
  }
  return true;
}

function buildSectionMap(sections: DraftSection[]) {
  const map = new Map<string, DraftSection>();
  sections.forEach((section) => map.set(section.id, section));
  return map;
}

function buildMatchIds(
  sections: DraftSection[],
  filter: OutlineFilterState,
  outlineDisabledIds?: string[]
): Set<string> {
  const matches = new Set<string>();
  const normalized = filter.query.trim().toLowerCase();
  const hasQuery = normalized.length > 0;
  const filterSelected = filter.selectedOnly;

  if (!hasQuery && !filterSelected) {
    return matches;
  }

  sections.forEach((section) => {
    if (filterSelected && !isSectionEnabled(section, outlineDisabledIds)) {
      return;
    }
    if (!hasQuery) {
      matches.add(section.id);
      return;
    }
    const haystack = section.title.toLowerCase();
    if (haystack.includes(normalized)) {
      matches.add(section.id);
    }
  });

  return matches;
}

function buildForcedOpen(matches: Set<string>, parentMap: Map<string, string | undefined>) {
  const forced = new Set<string>();
  matches.forEach((id) => {
    let current = parentMap.get(id);
    while (current) {
      forced.add(current);
      current = parentMap.get(current);
    }
  });
  return forced;
}

export function filterOutlineNodes(args: {
  nodes: OutlineNodeVM[];
  sections: DraftSection[];
  outlineDisabledIds?: string[];
  filter: OutlineFilterState;
  parentMap: Map<string, string | undefined>;
}): { visible: OutlineNodeVM[]; matchIds: Set<string>; forcedOpenIds: Set<string> } {
  const { nodes, sections, outlineDisabledIds, filter, parentMap } = args;
  const matchIds = buildMatchIds(sections, filter, outlineDisabledIds);
  const forcedOpenIds = buildForcedOpen(matchIds, parentMap);
  const sectionMap = buildSectionMap(sections);
  const filtering = matchIds.size > 0 || filter.selectedOnly || filter.query.trim().length > 0;
  const visible: OutlineNodeVM[] = [];
  const stack: Array<{ depth: number; hidden: boolean; isCollapsed: boolean }> = [];

  nodes.forEach((node) => {
    while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const hiddenByParent = parent ? parent.hidden || parent.isCollapsed : false;
    const includeByFilter =
      !filtering || matchIds.has(node.id) || forcedOpenIds.has(node.id);
    const isCollapsed = node.isCollapsed && !forcedOpenIds.has(node.id);
    const hidden = hiddenByParent || !includeByFilter;
    if (!hidden) {
      const section = sectionMap.get(node.id);
      visible.push({
        ...node,
        title: section?.title ?? node.title,
        isCollapsed
      });
    }
    stack.push({ depth: node.depth, hidden, isCollapsed });
  });

  return { visible, matchIds, forcedOpenIds };
}
