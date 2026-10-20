import { installOptions } from "@/lib/installControl";
import InstallDialog from "./InstallDialog";

/** The same install as the catalogue's own dialog, as a page: for when the
 *  catalogue cannot reach this app from the browser (a catalogue on another
 *  site, or a link opened by hand). */
export default async function InstallPage({ searchParams }: { searchParams: Promise<{ slug?: string; project?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="center">
      <section className="card install-dialog" aria-labelledby="install-title">
        <h1 id="install-title">Install a checklist</h1>
        {await body(sp.slug?.trim() ?? "", sp.project)}
      </section>
    </main>
  );
}

async function body(slug: string, wanted: string | undefined) {
  const options = await installOptions(slug, wanted);
  if (!options.ok) return <div className="error">{options.error}</div>;
  return (
    <InstallDialog
      slug={slug}
      control={options.control}
      projects={options.projects}
      preselect={options.preselect}
      installed={options.installed}
    />
  );
}
