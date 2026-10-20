import Link from "next/link";
import { notFound } from "next/navigation";
import { projectDbFor } from "@/lib/projectDb";
import {
  archiveSubmission,
  discardDraft,
  reopenForAmendment,
  restoreSubmission,
} from "./actions";
import DraftEditForm from "./DraftEditForm";
import { submissionOfProject } from "@/lib/submissions";
import { formatDateTime } from "@/lib/formatDate";
import { groupByCategory } from "@/lib/questions";
import { answerSheet } from "@/lib/answerSheet";
import { answeredCount, coverage, readinessPercent } from "@/lib/scoring";
import { maturityLabel, statusLabel } from "@/lib/labels";

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
 * Returns the full draft-to-final version history for a submission, ordered
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
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>;
  searchParams?: Promise<{ discard?: string }>;
}) {
  const { project, id } = await params;
  const askedToDiscard = (await searchParams)?.discard === "1";

  // Next does not add basePath to a raw <a href> link, so it is prefixed here
  // (as in SiteHeader) and the report download works when the app is served
  // under a subpath (/controls behind Caddy).
  const basePath = process.env.NEXT_BASE_PATH || "";

  // Read in this project's own database, so an id from the URL can only reach
  // this project's answers.
  const sub = await submissionOfProject(project, id);
  if (!sub) notFound();

  const chain = await loadVersionChain(project, sub.id, sub.checklistId);
  const isDraft = sub.status === "Draft";
  const isArchived = sub.archivedAt !== null;
  // An older closed version: its amendment already exists, so reopening it would only lead there.
  const at = chain.findIndex((v) => v.id === sub.id);
  const nextVersion = at >= 0 ? (chain[at + 1] ?? null) : null;

  // A closed submission shows the questions as it answered them; a draft, the template as it is now.
  const sheet = answerSheet(sub.status, sub.checklist.questions, sub.answers);
  const { answersByQ, scoresByQ, versionByQ } = sheet;
  const versionsAnswered = [
    ...new Set(sub.answers.map((a) => a.systemVersionNumber).filter((n): n is number => n !== null)),
  ].sort((x, y) => x - y);
  const totalQuestions = sheet.questions.length;
  const scoreValues = Object.values(scoresByQ);
  const scoredCount = scoreValues.length;
  const readiness = readinessPercent(scoreValues);
  const covered = coverage(
    answeredCount(
      sheet.questions.map((q) => ({ questionId: q.id, answer: answersByQ[q.id] ?? null, score: scoresByQ[q.id] ?? null })),
      sheet.questions.map((q) => q.id),
    ),
    totalQuestions,
  );

  return (
    <main className="page">
      <header className="page-header">
        <h1>
          {sub.label}{" "}
          <span className={`status status--${sub.status.toLowerCase()}`}>
            {statusLabel(sub.status)}
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
          {sub.closedAt && <> · finalised {formatDateTime(sub.closedAt)}</>}
          {sub.archivedAt && <> · archived {formatDateTime(sub.archivedAt)}</>}
          {versionsAnswered.length > 0 && (
            <> · answered under {versionsAnswered.map((n) => `v${n}`).join(", ")} of the AI card</>
          )}
        </p>
        {!isDraft && sub.questionsVersion !== null && (
          <p className="meta">Answered under checklist revision {sub.questionsVersion}</p>
        )}
      </header>

      <section className="readiness-summary" aria-label="Coverage and maturity summary">
        <div className="readiness-headline">
          <span className="readiness-value">
            {covered.percent !== null ? `${covered.percent}%` : "n/a"}
          </span>
          <span className="readiness-caption">Coverage</span>
        </div>
        <div className="readiness-headline">
          <span className="readiness-value">
            {readiness !== null ? `${readiness}%` : "n/a"}
          </span>
          <span className="readiness-caption">Maturity</span>
        </div>
        <div className="readiness-meta">
          <span>{covered.answered} of {totalQuestions} questions answered · {scoredCount} scored</span>
          <span className="readiness-hint">
            Coverage = questions answered out of all of them; maturity = their average score,
            100% = every scored question rated 5 (Optimized)
          </span>
        </div>
      </section>

      <div className="library-toolbar">
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
        {isDraft && !askedToDiscard && (
          <Link className="btn ghost" href={`/p/${project}/submissions/${sub.id}?discard=1`}>
            Discard draft
          </Link>
        )}
        {!isDraft && !isArchived && nextVersion && (
          <p className="meta">
            Replaced by{" "}
            <Link href={`/p/${project}/submissions/${nextVersion.id}`}>v{nextVersion.version}</Link>
          </p>
        )}
        {!isDraft && !isArchived && !nextVersion && (
          <>
            <form action={reopenForAmendment.bind(null, project, sub.id)}>
              <button className="btn" type="submit">
                Amend (makes version {sub.version + 1})
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

      {isDraft && askedToDiscard && (
        <section className="qf-section" aria-label="Discard draft">
          <p>Discard this draft and its answers? This cannot be undone.</p>
          <div className="qf-actions">
            <Link className="btn ghost" href={`/p/${project}/submissions/${sub.id}`}>
              Keep it
            </Link>
            <form action={discardDraft.bind(null, project, sub.id)}>
              <button className="btn" type="submit">
                Yes, discard it
              </button>
            </form>
          </div>
        </section>
      )}

      {chain.length > 1 && (
        <section className="version-chain" aria-label="Version history">
          <h3>Version history</h3>
          <ol>
            {chain.map((v) => {
              const entry = (
                <>
                  <span className="version-chip">v{v.version}</span>
                  <span className={`status status--${v.status.toLowerCase()}`}>
                    {statusLabel(v.status)}
                  </span>
                  {v.archivedAt && (
                    <span className="status status--archived">Archived</span>
                  )}
                  {v.closedAt && (
                    <span className="meta">finalised {formatDateTime(v.closedAt)}</span>
                  )}
                </>
              );
              // The version on screen is not a link: following it would only reload this page.
              return (
                <li key={v.id}>
                  {v.id === sub.id ? (
                    <span className="current" aria-current="true">
                      {entry}
                      <span className="meta">current</span>
                    </span>
                  ) : (
                    <Link href={`/p/${project}/submissions/${v.id}`}>{entry}</Link>
                  )}
                </li>
              );
            })}
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
        groupByCategory(sheet.questions).map((group, gi) => (
          <section key={gi} className="qf-section">
            {group.category && <h2>{group.category}</h2>}
            {group.items.map((q) => {
              const a = answersByQ[q.id];
              const score = scoresByQ[q.id];
              return (
                <div key={q.id} className="answer-block">
                  {q.article && <span className="tag tag--reg">{q.article}</span>}
                  <p className="q-text">{q.text}</p>
                  {score !== undefined && (
                    <span className={`score-badge score-badge--${score}`}>
                      {maturityLabel(score)}
                    </span>
                  )}
                  {a ? (
                    <p className="answer-text">{a}</p>
                  ) : (
                    <p className="answer-text muted">Not answered</p>
                  )}
                  {q.id in versionByQ && (
                    <p className="meta">
                      {versionByQ[q.id] !== null ? `answered under v${versionByQ[q.id]}` : "AI card version not recorded"}
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}
    </main>
  );
}
