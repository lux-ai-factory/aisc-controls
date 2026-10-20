import Link from "next/link";
import { notFound } from "next/navigation";
import { projectDbFor } from "@/lib/projectDb";
import { findCountry, findRegulation } from "@/data";
import SourceCitation from "@/components/SourceCitation";
import FillForm from "./FillForm";
import { statusLabel } from "@/lib/labels";

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

  // Answering here always starts an empty submission, so the ones already made
  // for this checklist are listed: the person may mean to carry one of them on.
  // Only the latest version of each, as the submissions list shows them.
  const [q, existing] = await Promise.all([
    prisma.checklist.findUnique({
      where: { id },
      include: {
        questions: { orderBy: { order: "asc" } },
        source: { select: { id: true, name: true, citation: true, url: true } },
      },
    }),
    prisma.submission.findMany({
      where: { checklistId: id, archivedAt: null, nextVersion: { is: null } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, label: true, status: true, version: true },
    }),
  ]);
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
        <p className="meta">This starts a new, empty submission. Nothing is copied from earlier ones.</p>
        {existing.length > 0 && (
          <>
            <p className="meta">Already answered for this checklist:</p>
            <ul>
              {existing.map((s) => (
                <li key={s.id}>
                  <Link href={`/p/${project}/submissions/${s.id}`}>{s.label}</Link>{" "}
                  <span className="version-chip">v{s.version}</span>{" "}
                  <span className={`status status--${s.status.toLowerCase()}`}>{statusLabel(s.status)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
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
