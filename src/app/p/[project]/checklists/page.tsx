import Link from "next/link";
import { callerAccess, projectDbFor } from "@/lib/projectDb";
import { countries, regulations, findCountry, findRegulation } from "@/data";
import SourceCitation from "@/components/SourceCitation";
import Pager from "@/components/Pager";
import { paginate } from "@/lib/pagination";
import { mayEditTemplate, templateEditorEnabled } from "@/lib/templateEditor";
import { launcherUrl } from "@/lib/appUrls";
import { withoutTrailingSlash } from "@/lib/http";
import LibraryFilters from "./LibraryFilters";

type PageProps = {
  params: Promise<{ project: string }>;
  searchParams: Promise<{
    country?: string;
    regulation?: string;
    source?: string;
    q?: string;
    page?: string;
    saved?: string;
  }>;
};

export default async function LibraryPage({ params, searchParams }: PageProps) {
  const { project } = await params;
  const prisma = await projectDbFor(project, { write: false });
  const sp = await searchParams;
  const country = sp.country?.trim() || null;
  const regulation = sp.regulation?.trim() || null;
  const sourceId = sp.source?.trim() || null;
  const search = sp.q?.trim() || null;
  // The editor's link, for administrators only
  const showTemplateEditor = templateEditorEnabled() && mayEditTemplate(await callerAccess(project));

  const [allRows, sources] = await Promise.all([
    prisma.checklist.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        source: { select: { id: true, name: true, citation: true, url: true } },
        _count: { select: { questions: true, submissions: true } },
      },
    }),
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows = allRows.filter((r) => {
    if (country && !r.countryIds.includes(country)) return false;
    if (regulation && !r.regulationIds.includes(regulation)) return false;
    if (sourceId && r.sourceId !== sourceId) return false;
    if (search) {
      const hay =
        `${r.title} ${r.source.name} ${r.controlTopic} ${r.description ?? ""}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
  const paged = paginate(rows, sp.page);
  const projectPage = `${withoutTrailingSlash(launcherUrl())}/p/${encodeURIComponent(project)}`;

  return (
    <main className="page">
      <header className="page-header">
        {sp.saved === "1" && <p className="info-banner">Checklist changes saved.</p>}
        <h1>Installed checklists</h1>
        <p>
          Checklists drawn from compliance documents. Filter by source,
          country, or regulation, then start a new submission on one.
        </p>
      </header>

      <LibraryFilters
        countries={countries}
        regulations={regulations}
        sources={sources}
        current={{ country, regulation, source: sourceId, search }}
      />

      {allRows.length === 0 ? (
        <div className="empty-state">
          <p>
            This project has no checklists yet. Install them from the project&apos;s catalogue: open
            the <a href={projectPage}>project page</a> and go to {"3. Choose tests and checklists"}.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No checklists match the current filters.</p>
        </div>
      ) : (
        <div className="library-grid">
          {paged.items.map((r) => (
            <article key={r.id} className="library-card">
              <div className="library-card-body">
                <h3>{r.title}</h3>
                <p className="meta">
                  <Link
                    href={`/p/${project}/checklists?source=${encodeURIComponent(r.source.id)}`}
                    className="tag tag--source"
                  >
                    {r.source.name}
                  </Link>{" "}
                  · {r.controlTopic}
                </p>
                {r.description && <p className="desc">{r.description}</p>}
                <SourceCitation
                  citation={r.source.citation}
                  url={r.source.url}
                  sourceUpdatedAt={r.sourceUpdatedAt}
                />
                <p className="page-tags">
                  {r.countryIds.map((c) => (
                    <span key={c} className="tag">
                      {findCountry(c)?.name ?? c}
                    </span>
                  ))}
                  {r.regulationIds.map((rg) => (
                    <span key={rg} className="tag tag--reg">
                      {findRegulation(rg)?.name ?? rg}
                    </span>
                  ))}
                </p>
                <p className="meta">
                  {r._count.questions} questions · {r._count.submissions} submissions
                </p>
              </div>
              <div className="library-card-actions">
                <Link className="btn" href={`/p/${project}/checklists/${r.id}/fill`}>
                  Start a new submission
                </Link>
                {showTemplateEditor && (
                  <Link
                    className="btn ghost"
                    href={`/p/${project}/checklists/${r.id}/review`}
                  >
                    Edit questions
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <Pager
        base={`/p/${project}/checklists`}
        params={{ country: sp.country, regulation: sp.regulation, source: sp.source, q: sp.q }}
        page={paged.page}
        totalPages={paged.totalPages}
      />
    </main>
  );
}
