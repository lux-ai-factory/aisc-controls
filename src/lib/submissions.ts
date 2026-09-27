/**
 * Answered checklists, read in the project's own database.
 *
 * The database is the project, so nothing here filters by project: there is
 * nothing of another project's in it to filter out.
 */
import { projectDbFor } from "@/lib/projectDb";

export async function submissionsOfProject(project: string) {
  const prisma = await projectDbFor(project, { write: false });
  return prisma.submission.findMany({
    where: { archivedAt: null, nextVersion: { is: null } },
    orderBy: { updatedAt: "desc" },
    include: {
      checklist: {
        select: { title: true, controlTopic: true, source: { select: { id: true, name: true } } },
      },
      answers: { select: { score: true } },
      _count: { select: { answers: true } },
    },
  });
}

export async function submissionOfProject(project: string, id: string) {
  const prisma = await projectDbFor(project, { write: false });
  return prisma.submission.findUnique({
    where: { id },
    include: {
      checklist: { include: { questions: { orderBy: { order: "asc" } }, source: { select: { name: true } } } },
      answers: true,
    },
  });
}

export async function archivedCountOfProject(project: string) {
  const prisma = await projectDbFor(project, { write: false });
  return prisma.submission.count({ where: { archivedAt: { not: null } } });
}
