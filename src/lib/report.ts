// Builds the JSON payload the bundled PDF renderer (services/pdf_renderer)
// turns into a submission report. Kept pure and free of Prisma/Next types so
// it can be unit-tested in isolation; the route handler adapts the DB rows into
// `ReportInput` and POSTs the result to the renderer.

import { groupByCategory } from "./questions";
import { readinessPercent, SCORE_LABELS, SCORE_VALUES } from "./scoring";
import { formatDateTime } from "./formatDate";

export type ReportQuestion = {
  id: string;
  order: number;
  text: string;
  article: string | null;
  category: string | null;
};

export type ReportInput = {
  label: string;
  status: string;
  version: number;
  createdAt: Date;
  closedAt: Date | null;
  checklistTitle: string;
  sourceName: string;
  controlTopic: string;
  countries: string[];
  regulations: string[];
  /** Checklist questions, already ordered. */
  questions: ReportQuestion[];
  /** Free-text answers keyed by question id. */
  answersByQ: Record<string, string>;
  /** 1–5 scores keyed by question id. */
  scoresByQ: Record<string, number>;
};

export type ReportItem = {
  text: string;
  article: string | null;
  score: number | null;
  scoreLabel: string | null;
  answer: string | null;
};

export type ReportPayload = {
  title: string;
  checklistTitle: string;
  sourceName: string;
  controlTopic: string;
  status: string;
  version: number;
  createdAt: string;
  closedAt: string | null;
  countries: string[];
  regulations: string[];
  readiness: number | null;
  scoredCount: number;
  totalQuestions: number;
  scoreScale: { value: number; label: string }[];
  // NB: field is `entries`, not `items` — in Jinja `group.items` resolves to
  // the dict's built-in items() method, not this list.
  groups: { category: string | null; entries: ReportItem[] }[];
  generatedAt: string;
};

export function buildReportPayload(
  input: ReportInput,
  generatedAt: Date,
): ReportPayload {
  const groups = groupByCategory(input.questions).map((g) => ({
    category: g.category,
    entries: g.items.map((q): ReportItem => {
      const score = input.scoresByQ[q.id] ?? null;
      return {
        text: q.text,
        article: q.article,
        score,
        scoreLabel: score != null ? (SCORE_LABELS[score] ?? null) : null,
        answer: input.answersByQ[q.id] ?? null,
      };
    }),
  }));

  const scoreValues = input.questions
    .map((q) => input.scoresByQ[q.id])
    .filter((s): s is number => s != null);

  return {
    title: input.label,
    checklistTitle: input.checklistTitle,
    sourceName: input.sourceName,
    controlTopic: input.controlTopic,
    status: input.status,
    version: input.version,
    createdAt: formatDateTime(input.createdAt),
    closedAt: input.closedAt ? formatDateTime(input.closedAt) : null,
    countries: input.countries,
    regulations: input.regulations,
    readiness: readinessPercent(scoreValues),
    scoredCount: scoreValues.length,
    totalQuestions: input.questions.length,
    scoreScale: SCORE_VALUES.map((v) => ({ value: v, label: SCORE_LABELS[v] })),
    groups,
    generatedAt: formatDateTime(generatedAt),
  };
}
