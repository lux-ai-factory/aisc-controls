/**
 * Converts arbitrary text into a URL-safe slug: lowercased, accents stripped,
 * non-alphanumerics collapsed to single hyphens, trimmed, and capped at 60
 * characters.
 *
 * @example slugify("Human Oversight — Art. 14") // "human-oversight-art-14"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
