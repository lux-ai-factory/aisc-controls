/**
 * The states the controls app's ledger events keep (ledger phase 7). Each is built one way only, so an
 * item's chain holds: an event's `before` is its item's previous `after` (verify.py's chain check).
 */
import { createHash } from "node:crypto";

import { canonical } from "./canonical";

type Answer = { questionId: string; answer: string | null; score: number | null };

/** What a submission says: the whole of it, its answers ordered by question id (review m3). */
export function submissionState(label: string, status: string, answers: Answer[]) {
  return {
    label,
    status,
    answers: answers
      .map((a) => ({ questionId: a.questionId, answer: a.answer, score: a.score }))
      .sort((x, y) => x.questionId.localeCompare(y.questionId)),
  };
}

type ChecklistMeta = {
  title: string;
  sourceId: string;
  controlTopic: string;
  description: string | null;
  sourceUpdatedAt: Date | null;
  countryIds: string[];
  regulationIds: string[];
};

/** A checklist's own fields (not its questions), as an edit's before and after keep them. */
export function checklistState(c: ChecklistMeta) {
  return {
    title: c.title,
    sourceId: c.sourceId,
    controlTopic: c.controlTopic,
    description: c.description,
    sourceUpdatedAt: c.sourceUpdatedAt ? c.sourceUpdatedAt.toISOString() : null,
    countryIds: [...c.countryIds],
    regulationIds: [...c.regulationIds],
  };
}

type QuestionRow = { id: string; order: number; text: string; article: string | null; category: string | null };

/** A checklist's questions with their ids, in order. */
export function questionsState(questions: QuestionRow[]) {
  return [...questions]
    .sort((x, y) => x.order - y.order)
    .map((q) => ({ id: q.id, order: q.order, text: q.text, article: q.article, category: q.category }));
}

/** The sha256 of a catalogue package as received, over its canonical form (review m5). */
export function packageDigest(pkg: unknown): string {
  return createHash("sha256").update(canonical(pkg), "utf8").digest("hex");
}
