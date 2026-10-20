// Builds the JSON payload the bundled PDF renderer (services/pdf_renderer)
// turns into a submission report. Kept pure and free of Prisma/Next types so
// it can be unit-tested in isolation; the route handler adapts the DB rows into
// `ReportInput` and POSTs the result to the renderer.

import { groupByCategory } from "./questions";
import { answeredCount, coverage, readinessPercent, SCORE_LABELS, SCORE_VALUES } from "./scoring";
import { statusLabel } from "./labels";
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
  /** The AI card version each answer was given under, keyed by question id; null: not stamped. A question
   *  with no answer row is not in it. */
  versionByQ: Record<string, number | null>;
};

export type ReportItem = {
  text: string;
  article: string | null;
  score: number | null;
  scoreLabel: string | null;
  answer: string | null;
  /** As the submission's page shows it: "answered under vN", "AI card version not recorded", or null without an answer. */
  stamp: string | null;
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
  /** Questions with an answer text or a score. */
  answeredCount: number;
  /** answeredCount out of totalQuestions, as a percentage; null without questions. */
  coverage: number | null;
  totalQuestions: number;
  scoreScale: { value: number; label: string }[];
  // The field is `entries`, not `items`: in Jinja `group.items` resolves to the
  // dict's built-in items() method, not this list.
  groups: { category: string | null; entries: ReportItem[] }[];
  /** The AI card versions the answers were given under, each once, in order. */
  cardVersions: number[];
  generatedAt: string;
};

function stampOf(versionByQ: Record<string, number | null>, questionId: string): string | null {
  if (!(questionId in versionByQ)) return null;
  const version = versionByQ[questionId];
  return version !== null ? `answered under v${version}` : "AI card version not recorded";
}

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
        stamp: stampOf(input.versionByQ, q.id),
      };
    }),
  }));

  const scoreValues = input.questions
    .map((q) => input.scoresByQ[q.id])
    .filter((s): s is number => s != null);
  const answered = answeredCount(
    input.questions.map((q) => ({
      questionId: q.id,
      answer: input.answersByQ[q.id] ?? null,
      score: input.scoresByQ[q.id] ?? null,
    })),
    input.questions.map((q) => q.id),
  );

  return {
    title: input.label,
    checklistTitle: input.checklistTitle,
    sourceName: input.sourceName,
    controlTopic: input.controlTopic,
    status: statusLabel(input.status),
    version: input.version,
    createdAt: formatDateTime(input.createdAt),
    closedAt: input.closedAt ? formatDateTime(input.closedAt) : null,
    countries: input.countries,
    regulations: input.regulations,
    readiness: readinessPercent(scoreValues),
    scoredCount: scoreValues.length,
    answeredCount: answered,
    coverage: coverage(answered, input.questions.length).percent,
    totalQuestions: input.questions.length,
    scoreScale: SCORE_VALUES.map((v) => ({ value: v, label: SCORE_LABELS[v] })),
    groups,
    cardVersions: [
      ...new Set(Object.values(input.versionByQ).filter((n): n is number => n !== null)),
    ].sort((x, y) => x - y),
    generatedAt: formatDateTime(generatedAt),
  };
}
