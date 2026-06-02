import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { findCountry, findRegulation } from "@/data";
import { formatDate } from "@/lib/formatDate";

export default async function HomePage() {
  const [checklistCount, questionCount, submissionCount, recentSubmissions] =
    await Promise.all([
      prisma.checklist.count(),
      prisma.question.count(),
      prisma.submission.count(),
      prisma.submission.findMany({
        where: { archivedAt: null, nextVersion: { is: null } },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          id: true,
          label: true,
          version: true,
          status: true,
          updatedAt: true,
          checklist: {
            select: {
              title: true,
              controlTopic: true,
              countryIds: true,
              regulationIds: true,
            },
          },
          _count: { select: { answers: true } },
        },
      }),
    ]);

  const countryName = (id: string) => findCountry(id)?.name ?? id;
  const regulationName = (id: string) => {
    const reg = findRegulation(id);
    return reg?.reference ?? reg?.name ?? id;
  };

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Control Checklists</span>
          <h1>
            Reusable control checklists, ready to{" "}
            <span className="hero-accent">answer for your AI system.</span>
          </h1>
          <p>
            Browse the library of regulatory control checklists (AESIA, EUSAiR,
            …) and answer each one against your AI system to generate audit
            evidence.
          </p>
          <div className="hero-actions">
            <Link className="btn" href="/checklists">
              Browse checklists
            </Link>
            <Link className="btn ghost" href="/submissions">
              Answered checklists
            </Link>
          </div>
        </div>

        <aside className="hero-stats" aria-label="Workspace stats">
          <div className="stat">
            <span className="stat-value">{checklistCount}</span>
            <span className="stat-label">Control checklists</span>
          </div>
          <div className="stat">
            <span className="stat-value">{questionCount}</span>
            <span className="stat-label">Control items</span>
          </div>
          <div className="stat">
            <span className="stat-value">{submissionCount}</span>
            <span className="stat-label">Answered checklists</span>
          </div>
        </aside>
      </section>

      <section className="how">
        <h2>How it works</h2>
        <ol className="how-steps">
          <li>
            <span className="step-num">1</span>
            <h3>Select</h3>
            <p>
              Pick a control checklist from the bundled library. Filter by
              source, country, or regulation.
            </p>
            <Link className="step-link" href="/checklists">
              Open the library →
            </Link>
          </li>
          <li>
            <span className="step-num">2</span>
            <h3>Answer</h3>
            <p>
              Answer each control item for your AI system, attach supporting
              evidence, then export the completed checklist for audit trails
              and regulatory submissions.
            </p>
            <Link className="step-link" href="/submissions">
              View answered checklists →
            </Link>
          </li>
        </ol>
      </section>

      <section className="home-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Recently answered checklists</h2>
            <Link href="/submissions" className="panel-link">
              All answered checklists →
            </Link>
          </div>
          {recentSubmissions.length === 0 ? (
            <p className="empty">
              No checklists have been answered yet. Pick one from the library
              to start.
            </p>
          ) : (
            <ul className="recent-list">
              {recentSubmissions.map((s) => (
                <li key={s.id}>
                  <Link href={`/submissions/${s.id}`} className="recent-item">
                    <span className="recent-title">
                      {s.label}{" "}
                      <span className={`status status--${s.status.toLowerCase()}`}>
                        {s.status}
                      </span>
                      <span className="version-chip">v{s.version}</span>
                    </span>
                    <span className="recent-meta">
                      {s.checklist.title} · {s._count.answers} answer
                      {s._count.answers === 1 ? "" : "s"} · last updated{" "}
                      {formatDate(s.updatedAt)}
                    </span>
                    <span className="recent-tags">
                      {s.checklist.countryIds.slice(0, 3).map((id) => (
                        <span key={`c-${id}`} className="tag">
                          {countryName(id)}
                        </span>
                      ))}
                      {s.checklist.regulationIds.slice(0, 3).map((id) => (
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
      </section>
    </main>
  );
}
