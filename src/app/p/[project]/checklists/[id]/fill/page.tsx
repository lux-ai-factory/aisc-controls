import { notFound } from "next/navigation";
import { projectDbFor } from "@/lib/projectDb";
import { findCountry, findRegulation } from "@/data";
import SourceCitation from "@/components/SourceCitation";
import FillForm from "./FillForm";

export default async function FillPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; id: string }>;
  searchParams: Promise<{ installed?: string }>;
}) {
  const { project, id } = await params;
  const installed = (await searchParams).installed;
  const prisma = await projectDbFor(project, { write: false });

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
        {installed === "new" && <p className="info-banner">Installed from the catalogue.</p>}
        {installed === "already" && <p className="info-banner">This project already had it; nothing changed.</p>}
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
        project={project}
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
