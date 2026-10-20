/** One question row of the review form. */
export type ReviewQuestion = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

/**
 * The rows with a blank question added at the end. Its id (the row's React key, and the hidden q.N.id the
 * server reads as "a new question") is `new-N` with the first N no row has, so add, remove, add never gives
 * two rows the same id.
 */
export function withBlankQuestion(rows: ReviewQuestion[]): ReviewQuestion[] {
  const taken = new Set(rows.map((r) => r.id));
  let n = rows.length;
  while (taken.has(`new-${n}`)) n += 1;
  return [...rows, { id: `new-${n}`, text: "", article: null, category: null }];
}

/**
 * What saving these rows takes from drafts, said before the save: a draft loses its answers to the questions
 * the save removes, a final submission keeps them. `draftAnswers` names, for each question, the drafts that
 * answered it. Null when no draft loses an answer.
 */
export function draftLossWarning(rows: ReviewQuestion[], draftAnswers: Record<string, string[]>): string | null {
  const kept = new Set(rows.map((r) => r.id));
  const removed = Object.keys(draftAnswers).filter((id) => !kept.has(id) && draftAnswers[id].length > 0);
  if (removed.length === 0) return null;
  const drafts = new Set(removed.flatMap((id) => draftAnswers[id])).size;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `Saving removes answers to ${plural(removed.length, "question")} from ${plural(drafts, "draft")}. `
    + "Final submissions keep theirs.";
}
