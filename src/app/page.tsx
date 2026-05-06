import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { countries, regulations } from "@/data";

export default async function HomePage() {
  const [questionnaireCount, questionCount, submissionCount, recent, recentSubmissions] =
    await Promise.all([
      prisma.questionnaire.count(),
      prisma.question.count(),
      prisma.submission.count(),
      prisma.questionnaire.findMany({
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          id: true,
          title: true,
          controlTopic: true,
          countryIds: true,
          regulationIds: true,
          createdAt: true,
          _count: { select: { questions: true } },
        },
      }),
      prisma.submission.findMany({
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          id: true,
          label: true,
          updatedAt: true,
          questionnaire: { select: { title: true } },
        },
      }),
    ]);

  const countryName = (id: string) =>
    countries.find((c) => c.id === id)?.name ?? id;
  const regulationName = (id: string) =>
    regulations.find((r) => r.id === id)?.reference ??
    regulations.find((r) => r.id === id)?.name ??
    id;
  const fmtDate = (d: Date) =>
    d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Compliance Questionnaires</span>
          <h1>
            Turn any compliance document into{" "}
            <span className="hero-accent">reusable controls.</span>
          </h1>
          <p>
            Upload compliance documents from any authority, standards body, or
            internal source. The model pulls the questions out, you build a
            library of control questionnaires, then compile each one against
            your AI system to capture the answers.
          </p>
          <div className="hero-actions">
            <Link className="btn" href="/questionnaires/new">
              Ingest a new questionnaire
            </Link>
            <Link className="btn ghost" href="/questionnaires">
              Browse library
            </Link>
            <Link className="btn ghost" href="/submissions">
              Compiled forms
            </Link>
          </div>
        </div>

        <aside className="hero-stats" aria-label="Workspace stats">
          <div className="stat">
            <span className="stat-value">{questionnaireCount}</span>
            <span className="stat-label">Questionnaires</span>
          </div>
          <div className="stat">
            <span className="stat-value">{questionCount}</span>
            <span className="stat-label">Questions extracted</span>
          </div>
          <div className="stat">
            <span className="stat-value">{submissionCount}</span>
            <span className="stat-label">Compiled forms</span>
          </div>
        </aside>
      </section>

      <section className="how">
        <h2>How it works</h2>
        <ol className="how-steps">
          <li>
            <span className="step-num">1</span>
            <h3>Ingest</h3>
            <p>
              Drop in a `.docx`, `.xlsx`, or `.csv` from any source — regulator,
              standards body, or internal team. The model extracts every
              distinct question, captures article references, and groups them
              by category.
            </p>
            <Link className="step-link" href="/questionnaires/new">
              Start an ingest →
            </Link>
          </li>
          <li>
            <span className="step-num">2</span>
            <h3>Curate</h3>
            <p>
              Review the extracted questions, fix anything the model missed, tag
              by country and regulation, and publish into the shared library.
            </p>
            <Link className="step-link" href="/questionnaires">
              Open the library →
            </Link>
          </li>
          <li>
            <span className="step-num">3</span>
            <h3>Compile</h3>
            <p>
              Run any questionnaire against your AI system to capture answers,
              then export the compiled form for audit or evidence packs.
            </p>
            <Link className="step-link" href="/submissions">
              View compiled forms →
            </Link>
          </li>
        </ol>
      </section>

      <section className="home-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Recently added</h2>
            <Link href="/questionnaires" className="panel-link">
              All questionnaires →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="empty">
              The library is empty. Ingest your first document to get started.
            </p>
          ) : (
            <ul className="recent-list">
              {recent.map((q) => (
                <li key={q.id}>
                  <Link href={`/questionnaires/${q.id}/review`} className="recent-item">
                    <span className="recent-title">{q.title}</span>
                    <span className="recent-meta">
                      {q.controlTopic} · {q._count.questions} question
                      {q._count.questions === 1 ? "" : "s"} · {fmtDate(q.createdAt)}
                    </span>
                    <span className="recent-tags">
                      {q.countryIds.slice(0, 3).map((id) => (
                        <span key={`c-${id}`} className="tag">
                          {countryName(id)}
                        </span>
                      ))}
                      {q.regulationIds.slice(0, 3).map((id) => (
                        <span key={`r-${id}`} className="tag tag-alt">
                          {regulationName(id)}
                        </span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Recent forms</h2>
            <Link href="/submissions" className="panel-link">
              All forms →
            </Link>
          </div>
          {recentSubmissions.length === 0 ? (
            <p className="empty">
              No compiled forms yet. Pick a questionnaire from the library to
              start one.
            </p>
          ) : (
            <ul className="recent-list">
              {recentSubmissions.map((s) => (
                <li key={s.id}>
                  <Link href={`/submissions/${s.id}`} className="recent-item">
                    <span className="recent-title">{s.label}</span>
                    <span className="recent-meta">
                      {s.questionnaire.title} · updated {fmtDate(s.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
