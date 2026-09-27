import SiteHeader from "@/components/SiteHeader";
import { notFoundUnlessProject } from "@/lib/projectDb";

/** Everything under here is one project's, and its header leads back to it. */
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
      {children}
    </>
  );
}
