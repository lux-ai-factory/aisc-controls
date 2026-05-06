import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const sub = await prisma.submission.findUnique({
    where: { id },
    include: {
      questionnaire: {
        include: {
          questions: { orderBy: { order: "asc" } },
          source: { select: { name: true } },
        },
      },
      answers: true,
    },
  });
  if (!sub) notFound();

  const answersByQ = new Map(sub.answers.map((a) => [a.questionId, a.answer]));

  return (
    <main className="page">
      <header className="page-header">
        <h1>{sub.label}</h1>
        <p>
          <strong>{sub.questionnaire.title}</strong> ·{" "}
          {sub.questionnaire.source.name}
        </p>
        <p className="meta">
          Saved {sub.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      </header>

      <div className="library-toolbar">
        <a className="btn ghost" href="/submissions">
          ← Back to submissions
        </a>
      </div>

      <section className="qf-section">
        <h2>Answers</h2>
        {sub.questionnaire.questions.map((q) => {
          const a = answersByQ.get(q.id);
          return (
            <div key={q.id} className="answer-block">
              {q.category && <span className="qf-cat">{q.category}</span>}
              {q.article && <span className="tag tag--reg">{q.article}</span>}
              <p className="q-text">{q.text}</p>
              {a ? (
                <p className="answer-text">{a}</p>
              ) : (
                <p className="answer-text muted">— not answered —</p>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
