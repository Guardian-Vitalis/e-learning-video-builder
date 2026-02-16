export function filterSectionsByTargetIds<T extends { id: string }>(
  sections: T[],
  targetSectionIds?: string[]
): T[] {
  if (!targetSectionIds || targetSectionIds.length === 0) {
    return sections;
  }
  const targetSet = new Set(targetSectionIds);
  return sections.filter((section) => targetSet.has(section.id));
}
