import Link from "next/link";
import { formatDate } from "@/lib/formatDate";
import { readinessPercent } from "@/lib/scoring";
import { archivedCountOfProject, submissionsOfProject } from "@/lib/submissions";

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const rows = await submissionsOfProject(project);

  const readinessById = new Map<string, number | null>();
  for (const r of rows) {
    const scores = r.answers.map((a) => a.score).filter((s): s is number => s != null);
    readinessById.set(r.id, readinessPercent(scores));
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
          {rows.map((r) => (
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
                  Readiness:{" "}
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
    </main>
  );
}
