import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { findCountry, findRegulation } from "@/data";
import SourceCitation from "@/components/SourceCitation";
import FillForm from "./FillForm";

export default async function FillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const q = await prisma.checklist.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: "asc" } },
      source: { select: { id: true, name: true, citation: true, url: true } },
    },
  });
  if (!q) notFound();

  return (
    <main className="page">
      <header className="page-header">
        <h1>{q.title}</h1>
        <p>
          <strong>{q.source.name}</strong> · {q.controlTopic} · {q.questions.length}{" "}
          questions
        </p>
        <p className="page-tags">
          {q.countryIds.map((c) => (
            <span key={c} className="tag">
              {findCountry(c)?.name ?? c}
            </span>
          ))}
          {q.regulationIds.map((rg) => (
            <span key={rg} className="tag tag--reg">
              {findRegulation(rg)?.name ?? rg}
            </span>
          ))}
        </p>
        {q.description && <p>{q.description}</p>}
        <SourceCitation
          citation={q.source.citation}
          url={q.source.url}
          sourceUpdatedAt={q.sourceUpdatedAt}
        />
      </header>
      <FillForm
        checklistId={q.id}
        questions={q.questions.map((qq) => ({
          id: qq.id,
          text: qq.text,
          article: qq.article,
          category: qq.category,
        }))}
      />
    </main>
  );
}
