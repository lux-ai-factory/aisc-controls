/**
 * The questions a submission's page and report show, with its answers by question.
 *
 * A draft follows the template: today's questions. A closed submission is frozen: each question it answered is
 * shown as it was when it was closed (the wording its answer keeps), an answer to a question removed since
 * included. The template's questions it left unanswered have no answer to keep their wording, so they are
 * shown as they are now.
 */
export type SheetQuestion = {
  /** The question's id; an answer to a removed question has none, and is keyed by its own. */
  id: string;
  order: number;
  text: string;
  article: string | null;
  category: string | null;
};

type LiveQuestion = SheetQuestion;

type StoredAnswer = {
  id: string;
  questionId: string | null;
  answer: string | null;
  score: number | null;
  systemVersionNumber: number | null;
  questionText: string | null;
  questionArticle: string | null;
  questionCategory: string | null;
  questionOrder: number | null;
};

export type AnswerSheet = {
  /** In order. */
  questions: SheetQuestion[];
  answersByQ: Record<string, string>;
  scoresByQ: Record<string, number>;
  /** The AI card version each answer was given under; null: not stamped. A question without an answer row is not in it. */
  versionByQ: Record<string, number | null>;
};

export function answerSheet(status: string, live: LiveQuestion[], answers: StoredAnswer[]): AnswerSheet {
  const byId = new Map(live.map((q) => [q.id, q]));
  const keyed: Array<{ key: string; answer: StoredAnswer }> = [];
  let questions: SheetQuestion[];

  if (status === "Closed") {
    const answered: SheetQuestion[] = [];
    for (const a of answers) {
      const now = a.questionId !== null ? byId.get(a.questionId) : undefined;
      // An answer closed before the wording was kept takes today's, the best known.
      if (a.questionText === null && !now) continue;
      const key = a.questionId ?? `removed-${a.id}`;
      answered.push(a.questionText !== null
        ? { id: key, order: a.questionOrder ?? now?.order ?? 0, text: a.questionText,
            article: a.questionArticle, category: a.questionCategory }
        : { ...now!, id: key });
      keyed.push({ key, answer: a });
    }
    const unanswered = live.filter((q) => !answers.some((a) => a.questionId === q.id));
    // sort is stable: at the same place, the answered question comes first
    questions = [...answered, ...unanswered].sort((x, y) => x.order - y.order);
  } else {
    questions = live;
    for (const a of answers) if (a.questionId !== null && byId.has(a.questionId)) keyed.push({ key: a.questionId, answer: a });
  }

  const sheet: AnswerSheet = { questions, answersByQ: {}, scoresByQ: {}, versionByQ: {} };
  for (const { key, answer } of keyed) {
    if (answer.answer != null) sheet.answersByQ[key] = answer.answer;
    if (answer.score != null) sheet.scoresByQ[key] = answer.score;
    sheet.versionByQ[key] = answer.systemVersionNumber;
  }
  return sheet;
}
