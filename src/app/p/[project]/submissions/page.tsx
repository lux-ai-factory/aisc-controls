import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import { answeredCount, coverage, type Coverage, readinessPercent } from "@/lib/scoring";
import { archivedCountOfProject, submissionsOfProject } from "@/lib/submissions";
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
    const questionIds = r.checklist.questions.map((q) => q.id);
    const scores = r.answers.map((a) => a.score).filter((s): s is number => s != null);
    readinessById.set(r.id, readinessPercent(scores));
    coverageById.set(r.id, coverage(answeredCount(r.answers, questionIds), questionIds.length));
  }

  const archivedCount = await archivedCountOfProject(project);

  return (
    <main className="page">
      <header className="page-header">
        <h1>Answered checklists</h1>
        <p>
          Every checklist answered against an AI system. Showing the latest
          version of each chain — open one to see its full version history.
        </p>
      </header>

      <div className="library-toolbar">
        <Link className="btn ghost" href={`/p/${project}/checklists`}>
          ← Back to library
        </Link>
        <Link className="btn ghost" href={`/p/${project}/submissions/archived`}>
          Archived ({archivedCount})
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>No checklists have been answered yet.</p>
          <Link className="btn" href={`/p/${project}/checklists`}>
            Open the library
          </Link>
        </div>
      ) : (
        <div className="library-grid">
          {paged.items.map((r) => (
            <article key={r.id} className="library-card">
              <div className="library-card-body">
                <h3>
                  {r.label}{" "}
                  <span className={`status status--${r.status.toLowerCase()}`}>
                    {r.status}
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
                  {" · "}Readiness:{" "}
                  <strong>
                    {readinessById.get(r.id) !== null
                      ? `${readinessById.get(r.id)}%`
                      : "—"}
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
  if (!c || c.percent === null) return "—";
  return `${c.answered}/${c.total} (${c.percent}%)`;
}
