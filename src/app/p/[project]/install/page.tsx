import { redirect } from "next/navigation";
import { appBasePath } from "@/lib/appUrls";
import { installOptions, installPagePath } from "@/lib/installControl";
import InstallDialog from "@/app/install/InstallDialog";

/** The same install as the catalogue's own dialog, as a page under the project the control goes into: for
 *  when the catalogue cannot reach this app from the browser (a catalogue on another site, or a link opened
 *  by hand). The install is posted to this address, where the gateway binds it to the project, so the
 *  project's ledger records it. */
export default async function ProjectInstallPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ slug?: string }>;
}) {
  const { project } = await params;
  const slug = (await searchParams).slug?.trim() ?? "";
  const options = await installOptions(slug, project);
  // This project's catalogue cannot give the control but another's can: that project's page installs it
  if (options.ok && options.preselect !== project) redirect(installPagePath(options.preselect, slug));
  return (
    <main className="center">
      <section className="card install-dialog" aria-labelledby="install-title">
        <h1 id="install-title">Install a checklist</h1>
        {options.ok ? (
          <InstallDialog
            slug={slug}
            address={project}
            installPageBase={appBasePath()}
            control={options.control}
            projects={options.projects}
            preselect={options.preselect}
            installed={options.installed}
          />
        ) : (
          <div className="error">{options.error}</div>
        )}
      </section>
    </main>
  );
}
