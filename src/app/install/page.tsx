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
        <h1 id="install-title">Install a control</h1>
        {await body(sp.slug?.trim() ?? "", sp.project)}
      </section>
    </main>
  );
}

async function body(slug: string, wanted: string | undefined) {
  const options = await installOptions(slug, wanted);
  if (!options.ok) return <div className="error">{options.error}</div>;
  if (options.projects.length === 0 || !options.preselect) {
    const launcher = process.env.LAUNCHER_URL ?? "/";
    return (
      <p>
        You cannot change any project, so there is none to install into. An owner of a project can make you an editor
        of it, or you can <a href={launcher}>create a project</a>.
      </p>
    );
  }
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
