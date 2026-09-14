// Readiness scoring, shared across the fill form, draft editor, and submission
// views. One scale, one parser, and one readiness formula so the surfaces can
// never drift out of sync.

export const SCORE_VALUES = [1, 2, 3, 4, 5] as const;

export const SCORE_LABELS: Record<number, string> = {
  1: "Not started",
  2: "Ad-hoc",
  3: "Developing",
  4: "Established",
  5: "Optimized",
};

/**
 * Parses a raw form value into a 1–5 score.
 *
 * @returns the score, or `null` if the value is blank or out of range.
 */
export function parseScore(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * Average score expressed as a 0–100% readiness figure (every control at 5/5 =
 * 100%).
 *
 * @returns the rounded percentage, or `null` when nothing has been scored yet.
 */
export function readinessPercent(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const average = scores.reduce((sum, n) => sum + n, 0) / scores.length;
  return Math.round((average / 5) * 100);
}
