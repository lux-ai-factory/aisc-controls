/**
 * What the pages show of a proof file, for the browser too: this module imports no server code, so a
 * client component may use it (src/lib/proofFiles.ts holds the links and their ledger events).
 */
import type { StoredFile } from "@/lib/proofStore";

export const MAX_FILES_PER_QUESTION = 10;

/** A linked file as the pages show it. */
export type ProofLink = StoredFile & { uploadedBy: string | null; uploadedAt: string };

/** A size as people read it: 512 B, 3.4 KB, 12 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
