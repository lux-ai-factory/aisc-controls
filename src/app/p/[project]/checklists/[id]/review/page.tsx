import { notFound } from "next/navigation";
import { callerAccess, projectDbFor } from "@/lib/projectDb";
import { mayEditTemplate, templateEditorEnabled } from "@/lib/templateEditor";
import { countries, regulations } from "@/data";
import ReviewForm from "./ReviewForm";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}) {
  // Off, the editor is not there at all, not just unlinked.
  if (!templateEditorEnabled()) notFound();
  const { project, id } = await params;
  const prisma = await projectDbFor(project, { write: false });
  // On, it is for administrators only; anybody else finds no editor here.
  if (!mayEditTemplate(await callerAccess(project))) notFound();

  const [q, sources, inDrafts] = await Promise.all([
    prisma.checklist.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: "asc" } } },
    }),
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // the drafts' answers, so the form can say which drafts a removed question takes answers from
    prisma.submissionAnswer.findMany({
      where: { question: { checklistId: id }, submission: { status: "Draft" } },
      select: { questionId: true, submissionId: true },
    }),
  ]);
  if (!q) notFound();
  const draftAnswers: Record<string, string[]> = {};
  for (const a of inDrafts) if (a.questionId) (draftAnswers[a.questionId] ??= []).push(a.submissionId);

  return (
    <main className="page">
      <header className="page-header">
        <h1>Edit checklist</h1>
        <p>
          {q.questions.length} questions.
        </p>
      </header>
      <ReviewForm
        project={project}
        checklistId={q.id}
        meta={{
          title: q.title,
          sourceId: q.sourceId,
          controlTopic: q.controlTopic,
          description: q.description,
          sourceUpdatedAt: q.sourceUpdatedAt
            ? q.sourceUpdatedAt.toISOString().slice(0, 10)
            : null,
          countryIds: q.countryIds,
          regulationIds: q.regulationIds,
        }}
        questions={q.questions.map((qq) => ({
          id: qq.id,
          text: qq.text,
          article: qq.article,
          category: qq.category,
        }))}
        countries={countries}
        regulations={regulations}
        sources={sources}
        draftAnswers={draftAnswers}
      />
    </main>
  );
}
