import { redirect } from "next/navigation";

/** A project's entry: its available checklists, the first thing anyone does here. */
export default async function ProjectEntry({ params }: { params: Promise<{ project: string }> }) {
  const { project } = await params;
  redirect(`/p/${encodeURIComponent(project)}/checklists`);
}
