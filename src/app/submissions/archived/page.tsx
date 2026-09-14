import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/formatDate";

export default async function ArchivedSubmissionsPage() {
  const rows = await prisma.submission.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    include: {
      checklist: {
        select: {
          title: true,
          controlTopic: true,
          source: { select: { id: true, name: true } },
        },
      },
      _count: { select: { answers: true } },
    },
  });

  return (
    <main className="page">
      <header className="page-header">
        <h1>Archived checklists</h1>
        <p>
          Closed checklists that have been moved out of the active workspace.
          Restore one to amend it or surface it back in the main list.
        </p>
      </header>

      <div className="library-toolbar">
        <Link className="btn ghost" href="/submissions">
          ← Back to answered checklists
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>Nothing archived yet.</p>
        </div>
      ) : (
        <div className="library-grid">
          {rows.map((r) => (
            <article key={r.id} className="library-card">
              <div className="library-card-body">
                <h3>
                  {r.label}{" "}
                  <span className="version-chip">v{r.version}</span>
                  <span className="status status--archived">Archived</span>
                </h3>
                <p className="meta">
                  <strong>{r.checklist.title}</strong>
                </p>
                <p className="meta">
                  {r.checklist.source.name} · {r.checklist.controlTopic}
                </p>
                <p className="meta">
                  {r._count.answers} answers · archived{" "}
                  {formatDate(r.archivedAt!)}
                </p>
              </div>
              <div className="library-card-actions">
                <Link className="btn" href={`/submissions/${r.id}`}>
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
