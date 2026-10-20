/**
 * Long lists, ten at a time. The page comes from ?page=N; a missing, invalid or
 * out-of-range page reads as the nearest page there is.
 */
export const PAGE_SIZE = 10;

export type Paged<T> = { items: T[]; page: number; totalPages: number; total: number };

export function paginate<T>(items: T[], page: string | undefined, size = PAGE_SIZE): Paged<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const asked = /^\d+$/.test(page ?? "") ? Number(page) : 1;
  const current = Math.min(Math.max(asked, 1), totalPages);
  return {
    items: items.slice((current - 1) * size, current * size),
    page: current,
    totalPages,
    total: items.length,
  };
}

/** The link to `page` of a list, keeping its other filters; page 1 is the bare list. */
export function pageHref(base: string, params: Record<string, string | undefined>, page: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}
