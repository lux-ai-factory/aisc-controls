/**
 * The header.
 *
 * Inside a project every link stays inside it, and the first of them goes back
 * to that project's page on the launcher, where the other five steps are. The
 * project is chosen there and this app never asks again, so this is the way
 * back out.
 */
import { appBasePath, launcherUrl } from "@/lib/appUrls";
import { withoutTrailingSlash } from "@/lib/http";

export default function SiteHeader({ project }: { project?: string }) {
  // Raw <a href> links and public/ files, so each one adds the base path itself.
  const basePath = appBasePath();
  const projectPage = project
    ? `${withoutTrailingSlash(launcherUrl())}/p/${encodeURIComponent(project)}`
    : null;
  const inProject = project ? `${basePath}/p/${encodeURIComponent(project)}` : null;

  return (
    <header className="site-header">
      <div className="inner">
        <a href={projectPage ?? `${basePath}/`} className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}/laif-logo.svg`} alt="Luxembourg AI Factory" />
        </a>
        <nav>
          {projectPage && (
            <a href={projectPage} aria-label="Back to the project">
              ← Back
            </a>
          )}
          {inProject && <a href={`${inProject}/checklists`}>Library</a>}
          {inProject && <a href={`${inProject}/submissions`}>Answered checklists</a>}
          {inProject && <a href={`${inProject}/sources`}>Sources</a>}
        </nav>
      </div>
    </header>
  );
}
