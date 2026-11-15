/**
 * The short name of an AI card version and its revision, as the qualification app writes it: "v1" for a
 * version whose card was never corrected (or whose revision was not recorded), "v1.2" for its revision 2.
 * The long form, in the qualification app's pages, is "Version 1" and "Version 1, revision 2".
 */
export function cardVersionShort(version: number, revision: number | null = null): string {
  return revision !== null && revision > 1 ? `v${version}.${revision}` : `v${version}`;
}
