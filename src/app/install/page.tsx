import { redirect } from "next/navigation";
import { installOptions, installPagePath } from "@/lib/installControl";

/** The install page the catalogue links to without a project: it opens the install page of the project
 *  the catalogue named (or the first one that can take the control), where the install is recorded. */
export default async function InstallPage({ searchParams }: { searchParams: Promise<{ slug?: string; project?: string }> }) {
  const sp = await searchParams;
  const slug = sp.slug?.trim() ?? "";
  const options = await installOptions(slug, sp.project);
  if (options.ok) redirect(installPagePath(options.preselect, slug));
  return (
    <main className="center">
      <section className="card install-dialog" aria-labelledby="install-title">
        <h1 id="install-title">Install a checklist</h1>
        <div className="error">{options.error}</div>
      </section>
    </main>
  );
}
