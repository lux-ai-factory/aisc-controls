import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  archiveSubmission,
  reopenForAmendment,
  restoreSubmission,
} from "./actions";
import DraftEditForm from "./DraftEditForm";
import { formatDateTime } from "@/lib/formatDate";
import { readinessPercent } from "@/lib/scoring";

type ChainEntry = {
  id: string;
  version: number;
  status: "Draft" | "Closed";
  closedAt: Date | null;
  archivedAt: Date | null;
};

const chainSelect = {
  id: true,
  version: true,
  status: true,
  closedAt: true,
  archivedAt: true,
  previousVersionId: true,
} as const;

/**
 * Returns the full Draft → Closed version history for a submission, ordered
 * oldest-first. Loads every version under the checklist in a single query and
 * reconstructs the linked list in memory, rather than walking it one round-trip
 * at a time.
 */
async function loadVersionChain(
  submissionId: string,
  checklistId: string,
): Promise<ChainEntry[]> {
  const all = await prisma.submission.findMany({
    where: { checklistId },
    select: chainSelect,
  });
  const byId = new Map(all.map((s) => [s.id, s]));
  // previousVersionId is unique, so this maps each node to its single successor.
  const successorOf = new Map(
    all
      .filter((s) => s.previousVersionId)
      .map((s) => [s.previousVersionId as string, s]),
  );

  // Walk back to the root of this submission's chain…
  let root = byId.get(submissionId);
  while (root?.previousVersionId) {
    const prev = byId.get(root.previousVersionId);
    if (!prev) break;
    root = prev;
  }

  // …then walk forward, following successors.
  const chain: ChainEntry[] = [];
  for (let cursor = root; cursor; cursor = successorOf.get(cursor.id)) {
    chain.push({
      id: cursor.id,
      version: cursor.version,
      status: cursor.status as "Draft" | "Closed",
      closedAt: cursor.closedAt,
      archivedAt: cursor.archivedAt,
    });
  }
  return chain;
}

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sub = await prisma.submission.findUnique({
    where: { id },
    include: {
      checklist: {
        include: {
          questions: { orderBy: { order: "asc" } },
          source: { select: { name: true } },
        },
      },
      answers: true,
    },
  });
  if (!sub) notFound();

  const chain = await loadVersionChain(sub.id, sub.checklistId);
  const isDraft = sub.status === "Draft";
  const isArchived = sub.archivedAt !== null;

  const answersByQ: Record<string, string> = {};
  const scoresByQ: Record<string, number> = {};
  for (const a of sub.answers) {
    if (a.answer != null) answersByQ[a.questionId] = a.answer;
    if (a.score != null) scoresByQ[a.questionId] = a.score;
  }
  const totalQuestions = sub.checklist.questions.length;
  const scoreValues = Object.values(scoresByQ);
  const scoredCount = scoreValues.length;
  const readiness = readinessPercent(scoreValues);

  return (
    <main className="page">
      <header className="page-header">
        <h1>
          {sub.label}{" "}
          <span className={`status status--${sub.status.toLowerCase()}`}>
            {sub.status}
          </span>
          <span className="version-chip">v{sub.version}</span>
          {isArchived && <span className="status status--archived">Archived</span>}
        </h1>
        <p>
          <strong>{sub.checklist.title}</strong> ·{" "}
          {sub.checklist.source.name}
        </p>
        <p className="meta">
          Created {formatDateTime(sub.createdAt)}
          {sub.closedAt && <> · closed {formatDateTime(sub.closedAt)}</>}
          {sub.archivedAt && <> · archived {formatDateTime(sub.archivedAt)}</>}
        </p>
      </header>

      <section className="readiness-summary" aria-label="Readiness summary">
        <div className="readiness-headline">
          <span className="readiness-value">
            {readiness !== null ? `${readiness}%` : "—"}
          </span>
          <span className="readiness-caption">Readiness</span>
        </div>
        <div className="readiness-meta">
          <span>{scoredCount} of {totalQuestions} controls scored</span>
          <span className="readiness-hint">
            100% = every control rated 5 (Optimized)
          </span>
        </div>
      </section>

      <div className="library-toolbar">
        <Link className="btn ghost" href="/submissions">
          ← Back to answered checklists
        </Link>
        <a className="btn" href={`/submissions/${sub.id}/report`}>
          Download report (PDF)
        </a>
        {isArchived && (
          <form action={restoreSubmission.bind(null, sub.id)}>
            <button className="btn" type="submit">
              Restore from archive
            </button>
          </form>
        )}
        {!isDraft && !isArchived && (
          <>
            <form action={reopenForAmendment.bind(null, sub.id)}>
              <button className="btn" type="submit">
                Reopen for amendment
              </button>
            </form>
            <form action={archiveSubmission.bind(null, sub.id)}>
              <button className="btn ghost" type="submit">
                Archive
              </button>
            </form>
          </>
        )}
      </div>

      {chain.length > 1 && (
        <section className="version-chain" aria-label="Version history">
          <h3>Version history</h3>
          <ol>
            {chain.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/submissions/${v.id}`}
                  className={v.id === sub.id ? "current" : ""}
                  aria-current={v.id === sub.id ? "true" : undefined}
                >
                  <span className="version-chip">v{v.version}</span>
                  <span className={`status status--${v.status.toLowerCase()}`}>
                    {v.status}
                  </span>
                  {v.archivedAt && (
                    <span className="status status--archived">Archived</span>
                  )}
                  {v.closedAt && (
                    <span className="meta">closed {formatDateTime(v.closedAt)}</span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {isDraft ? (
        <DraftEditForm
          submissionId={sub.id}
          label={sub.label}
          questions={sub.checklist.questions}
          answersByQ={answersByQ}
          scoresByQ={scoresByQ}
        />
      ) : (
        <section className="qf-section">
          <h2>Answers</h2>
          {sub.checklist.questions.map((q) => {
            const a = answersByQ[q.id];
            const score = scoresByQ[q.id];
            return (
              <div key={q.id} className="answer-block">
                {q.category && <span className="qf-cat">{q.category}</span>}
                {q.article && <span className="tag tag--reg">{q.article}</span>}
                <p className="q-text">{q.text}</p>
                {score !== undefined && (
                  <span className={`score-badge score-badge--${score}`}>
                    {score}/5
                  </span>
                )}
                {a ? (
                  <p className="answer-text">{a}</p>
                ) : (
                  <p className="answer-text muted">— not answered —</p>
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
