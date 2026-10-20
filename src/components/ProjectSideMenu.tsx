"use client";

import { usePathname } from "next/navigation";

/**
 * A project's menu on the left, as qualification's and control objectives':
 * the installed checklists and the submissions, and the archived submissions
 * at its bottom. "← Collect evidence" is not one of them: it is the header's own button.
 *
 * Raw <a href> links, so each one adds the base path itself (as SiteHeader).
 * The path from usePathname has no base path, so the item of the page shown is
 * found from the project path alone.
 */
export default function ProjectSideMenu({ project, basePath }: { project: string; basePath: string }) {
  const here = usePathname() ?? "";
  const inProject = `/p/${encodeURIComponent(project)}`;
  const under = (section: string) =>
    here === `${inProject}/${section}` || here.startsWith(`${inProject}/${section}/`);
  // The archived submissions live under submissions/ but are an item of their own.
  const at = (section: string) =>
    section === "submissions" ? under(section) && !under("submissions/archived") : under(section);
  const href = (section: string) => `${basePath}${inProject}/${section}`;

  const item = (section: string, label: string, className = "cl-sidemenu-item") => (
    <a key={section} href={href(section)} className={className} aria-current={at(section) ? "page" : undefined}>
      {label}
    </a>
  );

  return (
    <aside className="cl-sidemenu">
      <nav aria-label="Checklists">
        {item("checklists", "Installed checklists")}
        {item("submissions", "Submissions")}
      </nav>
      <nav aria-label="Archive" className="cl-sidemenu-bottom">
        {item("submissions/archived", "Archived submissions", "cl-sidemenu-item cl-sidemenu-archived")}
      </nav>
    </aside>
  );
}
