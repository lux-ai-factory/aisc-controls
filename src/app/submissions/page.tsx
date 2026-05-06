import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/formatDate";

export default async function SubmissionsPage() {
  const rows = await prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      questionnaire: {
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
        <h1>Compiled forms</h1>
        <p>Every form that has been filled out, with answers saved.</p>
      </header>

      <div className="library-toolbar">
        <a className="btn ghost" href="/questionnaires">
          ← Back to library
        </a>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>No forms have been compiled yet.</p>
          <a className="btn" href="/questionnaires">
            Open the library
          </a>
        </div>
      ) : (
        <div className="library-grid">
          {rows.map((r) => (
            <article key={r.id} className="library-card">
              <div className="library-card-body">
                <h3>{r.label}</h3>
                <p className="meta">
                  <strong>{r.questionnaire.title}</strong>
                </p>
                <p className="meta">
                  {r.questionnaire.source.name} · {r.questionnaire.controlTopic}
                </p>
                <p className="meta">
                  {r._count.answers} answers · saved {formatDate(r.createdAt)}
                </p>
              </div>
              <div className="library-card-actions">
                <a className="btn" href={`/submissions/${r.id}`}>
                  View
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
