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
 * The scored questions' readiness as a 0–100% figure: each score is placed on the
 * scale with 1 "Not started" at 0% and 5 "Optimized" at 100% ((score - 1) / 4),
 * then averaged and rounded half up. (Average / 5 counted "Not started" as 20%.)
 *
 * @returns the rounded percentage, or `null` when nothing has been scored yet.
 */
export function readinessPercent(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const average = scores.reduce((sum, n) => sum + (n - 1) / 4, 0) / scores.length;
  return Math.round(average * 100);
}

export type Coverage = { answered: number; total: number; percent: number | null };

/**
 * How much of a checklist has been answered: answered questions out of all of
 * them, as a 0–100% figure. Readiness says how well the answered ones score;
 * coverage says how many were answered.
 *
 * @returns the counts and the rounded percentage, `null` for no questions.
 */
export function coverage(answered: number, total: number): Coverage {
  return { answered, total, percent: total > 0 ? Math.round((answered / total) * 100) : null };
}

/**
 * The checklist's questions that carry an answer text or a score. A row of a
 * question no longer in the checklist does not count.
 */
export function answeredCount(
  answers: { questionId: string; answer: string | null; score: number | null }[],
  questionIds: string[],
): number {
  const asked = new Set(questionIds);
  const answered = new Set(
    answers
      .filter((a) => asked.has(a.questionId) && ((a.answer ?? "").trim().length > 0 || a.score != null))
      .map((a) => a.questionId),
  );
  return answered.size;
}
