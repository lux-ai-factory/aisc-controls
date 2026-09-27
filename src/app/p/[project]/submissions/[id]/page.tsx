import Link from "next/link";
import { notFound } from "next/navigation";
import { projectDbFor } from "@/lib/projectDb";
import {
  archiveSubmission,
  reopenForAmendment,
  restoreSubmission,
} from "./actions";
import DraftEditForm from "./DraftEditForm";
import { submissionOfProject } from "@/lib/submissions";
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
  project: string,
  submissionId: string,
  checklistId: string,
): Promise<ChainEntry[]> {
  const prisma = await projectDbFor(project, { write: false });
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
  params: Promise<{ project: string; id: string }>;
}) {
  const { project, id } = await params;

  // Raw <a href> links are not rewritten by Next's basePath — prefix
  // explicitly (same pattern as SiteHeader) so the report download works
  // when the app is served under a subpath (e.g. /controls behind Caddy).
  const basePath = process.env.NEXT_BASE_PATH || "";

  // Read in this project's own database, so an id from the URL can only reach
  // this project's answers.
  const sub = await submissionOfProject(project, id);
  if (!sub) notFound();

  const chain = await loadVersionChain(project, sub.id, sub.checklistId);
  const isDraft = sub.status === "Draft";
  const isArchived = sub.archivedAt !== null;

  const answersByQ: Record<string, string> = {};
  const scoresByQ: Record<string, number> = {};
  // The AI card version each answer was given under; null: not stamped.
  const versionByQ: Record<string, number | null> = {};
  for (const a of sub.answers) {
    if (a.answer != null) answersByQ[a.questionId] = a.answer;
    if (a.score != null) scoresByQ[a.questionId] = a.score;
    versionByQ[a.questionId] = a.systemVersionNumber;
  }
  const versionsAnswered = [
    ...new Set(sub.answers.map((a) => a.systemVersionNumber).filter((n): n is number => n !== null)),
  ].sort((x, y) => x - y);
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
          {versionsAnswered.length > 0 && (
            <> · answered under {versionsAnswered.map((n) => `v${n}`).join(", ")} of the AI card</>
          )}
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
        <Link className="btn ghost" href={`/p/${project}/submissions`}>
          ← Back to answered checklists
        </Link>
        <a className="btn" href={`${basePath}/p/${project}/submissions/${sub.id}/report`}>
          Download report (PDF)
        </a>
        {isArchived && (
          <form action={restoreSubmission.bind(null, project, sub.id)}>
            <button className="btn" type="submit">
              Restore from archive
            </button>
          </form>
        )}
        {!isDraft && !isArchived && (
          <>
            <form action={reopenForAmendment.bind(null, project, sub.id)}>
              <button className="btn" type="submit">
                Reopen for amendment
              </button>
            </form>
            <form action={archiveSubmission.bind(null, project, sub.id)}>
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
                  href={`/p/${project}/submissions/${v.id}`}
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
          project={project}
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
                {q.id in versionByQ && (
                  <p className="meta">
                    {versionByQ[q.id] !== null ? `answered under v${versionByQ[q.id]}` : "not stamped"}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
