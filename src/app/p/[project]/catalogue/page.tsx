import Link from "next/link";
import { callerToken } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";
import { fetchCatalogueControls } from "@/lib/catalogueControls";
import { projectDbFor } from "@/lib/projectDb";
import { writableProjects } from "@/lib/writableProjects";
import InstallButton from "./InstallButton";

type PageProps = {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ q?: string }>;
};

const READ_ONLY = "You cannot change this project, so you cannot install into it. An owner can make you an editor.";

/** The catalogue's checklists, from inside a project: Install the new ones, Open the ones it has. */
export default async function CataloguePage({ params, searchParams }: PageProps) {
  const { project } = await params;
  const search = (await searchParams).q?.trim() || null;

  const [listed, installed, writable] = await Promise.all([
    fetchCatalogueControls(),
    projectDbFor(project, { write: false }).then((prisma) =>
      prisma.checklist.findMany({ where: { catalogueId: { not: null } }, select: { id: true, catalogueId: true } }),
    ),
    callerToken().then((token) => writableProjects(token, { platformUrl: platformUrl() })),
  ]);
  const installedBySlug = new Map(installed.map((c) => [c.catalogueId, c.id]));
  // When the platform cannot say, Install is left on: the action checks again and says why.
  const disabledReason = writable !== null && !writable.some((p) => p.pid === project) ? READ_ONLY : null;

  const controls = listed.ok
    ? listed.controls.filter(
        (c) => !search || `${c.name} ${c.description ?? ""}`.toLowerCase().includes(search.toLowerCase()),
      )
    : [];

  return (
    <main className="page">
      <header className="page-header">
        <h1>Catalogue</h1>
        <p>Checklists from the shared catalogue. Install one to add it to this project&apos;s library.</p>
      </header>

      <div className="library-toolbar">
        <Link className="btn ghost" href={`/p/${project}/checklists`}>
          Back to the library
        </Link>
      </div>

      {!listed.ok ? (
        <div className="error">{listed.reason}</div>
      ) : (
        <>
          <form method="get" className="library-filters catalogue-filters">
            <div className="field">
              <label htmlFor="q">Search</label>
              <input id="q" name="q" defaultValue={search ?? ""} placeholder="Name, description…" />
            </div>
            <div className="library-filter-actions">
              <button type="submit" className="btn">
                Search
              </button>
            </div>
          </form>

          {controls.length === 0 ? (
            <div className="empty-state">
              <p>No checklist in the catalogue matches the search.</p>
            </div>
          ) : (
            <div className="library-grid">
              {controls.map((c) => {
                const have = installedBySlug.get(c.slug);
                return (
                  <article key={c.slug} className="library-card">
                    <div className="library-card-body">
                      <h3>{c.name}</h3>
                      {c.description && <p className="desc">{c.description}</p>}
                    </div>
                    <div className="library-card-actions">
                      {have ? (
                        <>
                          <span className="tag">Installed</span>
                          <Link className="btn ghost" href={`/p/${project}/checklists/${have}/fill`}>
                            Open
                          </Link>
                        </>
                      ) : (
                        <InstallButton project={project} slug={c.slug} disabledReason={disabledReason} />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}
