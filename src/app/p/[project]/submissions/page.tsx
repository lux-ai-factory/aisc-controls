import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import { answeredCount, coverage, type Coverage, readinessPercent } from "@/lib/scoring";
import { submissionsOfProject } from "@/lib/submissions";
import { answerSheet } from "@/lib/answerSheet";
import { statusLabel } from "@/lib/labels";
import Pager from "@/components/Pager";
import { paginate } from "@/lib/pagination";

export default async function SubmissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { project } = await params;
  const sp = (await searchParams) ?? {};
  const rows = await submissionsOfProject(project);
  const paged = paginate(rows, sp.page);

  const readinessById = new Map<string, number | null>();
  const coverageById = new Map<string, Coverage>();
  for (const r of paged.items) {
    // counted over what its page shows: a closed one over the questions as it answered them
    const sheet = answerSheet(r.status, r.checklist.questions, r.answers);
    const questionIds = sheet.questions.map((q) => q.id);
    const answered = sheet.questions.map((q) => ({
      questionId: q.id, answer: sheet.answersByQ[q.id] ?? null, score: sheet.scoresByQ[q.id] ?? null,
    }));
    readinessById.set(r.id, readinessPercent(Object.values(sheet.scoresByQ)));
    coverageById.set(r.id, coverage(answeredCount(answered, questionIds), questionIds.length));
  }


  return (
    <main className="page">
      <header className="page-header">
        <h1>Submissions</h1>
        <p>
          Every checklist answered against an AI system, the latest version of
          each. Open one to see its full version history.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>No submissions yet: start one from the installed checklists.</p>
        </div>
      ) : (
        <div className="library-grid">
          {paged.items.map((r) => (
            <article key={r.id} className="library-card">
              <div className="library-card-body">
                <h3>
                  {r.label}{" "}
                  <span className={`status status--${r.status.toLowerCase()}`}>
                    {statusLabel(r.status)}
                  </span>
                  <span className="version-chip">v{r.version}</span>
                </h3>
                <p className="meta">
                  <strong>{r.checklist.title}</strong>
                </p>
                <p className="meta">
                  {r.checklist.source.name} · {r.checklist.controlTopic}
                </p>
                <p className="meta">
                  {r._count.answers} answers · last updated{" "}
                  {formatDate(r.updatedAt)}
                </p>
                <p className="readiness-line">
                  Coverage:{" "}
                  <strong>{formatCoverage(coverageById.get(r.id))}</strong>
                  {" · "}Maturity:{" "}
                  <strong>
                    {readinessById.get(r.id) !== null
                      ? `${readinessById.get(r.id)}%`
                      : "n/a"}
                  </strong>
                </p>
              </div>
              <div className="library-card-actions">
                <Link className="btn" href={`/p/${project}/submissions/${r.id}`}>
                  Open
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      <Pager base={`/p/${project}/submissions`} params={{}} page={paged.page} totalPages={paged.totalPages} />
    </main>
  );
}

function formatCoverage(c: Coverage | undefined): string {
  if (!c || c.percent === null) return "n/a";
  return `${c.answered}/${c.total} (${c.percent}%)`;
}
