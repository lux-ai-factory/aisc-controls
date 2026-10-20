import SiteHeader from "@/components/SiteHeader";
import ProjectSideMenu from "@/components/ProjectSideMenu";
import { appBasePath } from "@/lib/appUrls";
import { notFoundUnlessProject } from "@/lib/projectDb";

/** Everything under here is one project's: its header leads back to it, and its
 *  menu on the left leads to the project's checklists. */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  notFoundUnlessProject(project);
  return (
    <>
      <SiteHeader project={project} />
      <div className="cl-layout">
        <ProjectSideMenu project={project} basePath={appBasePath()} />
        <div className="cl-layout-main">{children}</div>
      </div>
    </>
  );
}
