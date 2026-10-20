/**
 * The header.
 *
 * Inside a project it holds "← Collect evidence", to that project's step 4 on
 * the launcher, where the checklists are opened from; the logo goes
 * to the project's page, where the other steps are. The project is chosen
 * there and this app never asks again, so these are the ways back out. The
 * project's own links are in the menu on the left (ProjectSideMenu).
 */
import { appBasePath, launcherUrl } from "@/lib/appUrls";
import { withoutTrailingSlash } from "@/lib/http";

export default function SiteHeader({ project }: { project?: string }) {
  // Raw <a href> links and public/ files, so each one adds the base path itself.
  const basePath = appBasePath();
  const projectPage = project
    ? `${withoutTrailingSlash(launcherUrl())}/p/${encodeURIComponent(project)}`
    : null;
  // The checklists are opened from the project's step 4, Collect evidence, so Back returns there.
  const sandboxPage = project
    ? `${withoutTrailingSlash(launcherUrl())}/evidence.html?project=${encodeURIComponent(project)}`
    : null;

  return (
    <header className="site-header">
      <div className="inner">
        <a href={projectPage ?? `${basePath}/`} className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}/laif-logo.svg`} alt="Luxembourg AI Factory" />
          <span className="divider" />
          <span>Checklists</span>
        </a>
        {sandboxPage && (
          <a href={sandboxPage} className="btn ghost site-back">
            ← Collect evidence
          </a>
        )}
      </div>
    </header>
  );
}
