import Link from "next/link";
import { prisma } from "@/lib/prisma";
import SourceCitation from "@/components/SourceCitation";

export default async function SourcesPage() {
  const sources = await prisma.source.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { checklists: true } } },
  });

  return (
    <main className="page">
      <header className="page-header">
        <h1>Sources / authorities</h1>
        <p>
          Register every authority, standards body, or organisation whose
          documents you reference. Each checklist belongs to one source, and
          sources double as a navigation tag in the library.
        </p>
      </header>

      <div className="library-toolbar">
        <Link className="btn" href="/sources/new">
          + Register a source
        </Link>
        <Link className="btn ghost" href="/checklists">
          ← Back to library
        </Link>
      </div>

      {sources.length === 0 ? (
        <div className="empty-state">
          <p>No sources yet. Register one before adding your first checklist.</p>
          <Link className="btn" href="/sources/new">
            Register a source
          </Link>
        </div>
      ) : (
        <div className="library-grid">
          {sources.map((s) => (
            <article key={s.id} className="library-card">
              <div className="library-card-body">
                <h3>{s.name}</h3>
                <p className="meta">
                  {s._count.checklists} checklist
                  {s._count.checklists === 1 ? "" : "s"}
                </p>
                <SourceCitation citation={s.citation} url={s.url} />
              </div>
              <div className="library-card-actions">
                <Link
                  className="btn"
                  href={`/checklists?source=${encodeURIComponent(s.id)}`}
                >
                  View checklists
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
