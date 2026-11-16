import Link from "next/link";
import { projectDbFor } from "@/lib/projectDb";
import { formatDate } from "@/lib/formatDate";
import { answerSheet } from "@/lib/answerSheet";
import { answeredCount } from "@/lib/scoring";

export default async function ArchivedSubmissionsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  const prisma = await projectDbFor(project, { write: false });
  const rows = await prisma.submission.findMany({
    where: { archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    include: {
      checklist: {
        select: {
          title: true,
          controlTopic: true,
          source: { select: { id: true, name: true } },
          questions: { select: { id: true, order: true, text: true, article: true, category: true } },
        },
      },
      answers: true,
    },
  });
  // The questions each one answered, as the Submissions page counts them: a row that holds only a proof
  // file is not an answer.
  const answered = new Map(rows.map((r) => {
    const sheet = answerSheet(r.status, r.checklist.questions, r.answers);
    const given = sheet.questions.map((q) => ({
      questionId: q.id, answer: sheet.answersByQ[q.id] ?? null, score: sheet.scoresByQ[q.id] ?? null,
    }));
    return [r.id, answeredCount(given, sheet.questions.map((q) => q.id))];
  }));

  return (
    <main className="page">
      <header className="page-header">
        <h1>Archived submissions</h1>
        <p>
          Final submissions that have been moved out of the active workspace.
          Restore one to amend it or surface it back in the main list.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p>Nothing archived yet.</p>
        </div>
      ) : (
        <div className="library-grid">
          {rows.map((r) => (
            <article key={r.id} className="library-card">
              <div className="library-card-body">
                <h3>
                  {r.label}{" "}
                  <span className="version-chip">v{r.version}</span>
                  <span className="status status--archived">Archived</span>
                </h3>
                <p className="meta">
                  <strong>{r.checklist.title}</strong>
                </p>
                <p className="meta">
                  {r.checklist.source.name} · {r.checklist.controlTopic}
                </p>
                <p className="meta">
                  {answered.get(r.id) ?? 0} {answered.get(r.id) === 1 ? "answer" : "answers"} · archived{" "}
                  {formatDate(r.archivedAt!)}
                </p>
              </div>
              <div className="library-card-actions">
                <Link className="btn" href={`/p/${project}/submissions/${r.id}`}>
                  Open
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
