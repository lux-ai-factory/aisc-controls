/**
 * Groups *consecutive* items that share a category, preserving the original
 * order, so forms can render one heading per category block (mirroring the
 * source document's layout). A category that recurs non-consecutively yields
 * separate groups by design.
 */
export function groupByCategory<T extends { category: string | null }>(
  items: T[],
): { category: string | null; items: T[] }[] {
  const groups: { category: string | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }
  return groups;
}
