import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { countries, regulations } from "@/data";
import ReviewForm from "./ReviewForm";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [q, sources] = await Promise.all([
    prisma.checklist.findUnique({
      where: { id },
      include: { questions: { orderBy: { order: "asc" } } },
    }),
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!q) notFound();

  return (
    <main className="page">
      <header className="page-header">
        <h1>Edit checklist</h1>
        <p>
          {q.questions.length} questions
          {q.originalFile ? ` from ${q.originalFile}` : ""}.
        </p>
      </header>
      <ReviewForm
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
      />
    </main>
  );
}
