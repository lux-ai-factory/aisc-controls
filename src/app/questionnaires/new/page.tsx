import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { countries, regulations } from "@/data";
import { checkIngestAvailability } from "@/lib/ingestAvailability";
import NewQuestionnaireForm from "./NewQuestionnaireForm";

export default async function NewQuestionnairePage() {
  const [sources, ingest] = await Promise.all([
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    checkIngestAvailability(),
  ]);

  return (
    <main className="page">
      <header className="page-header">
        <h1>Ingest a new questionnaire</h1>
        <p>
          Upload a source document and tag it. The model will read it and extract
          the compliance questions for you to review.
        </p>
      </header>

      {!ingest.ok ? (
        <div className="empty-state">
          <p>
            <strong>Ingest is unavailable.</strong> {ingest.reason}
          </p>
          <p className="qf-help">
            Browsing the bundled questionnaires still works — only ingest needs
            the LLM. See <code>README.md</code> §Path B for the full setup.
          </p>
          <Link className="btn ghost" href="/questionnaires">
            Back to library
          </Link>
        </div>
      ) : sources.length === 0 ? (
        <div className="empty-state">
          <p>You need to register at least one source before ingesting.</p>
          <Link className="btn" href="/sources/new">
            Register a source
          </Link>
        </div>
      ) : (
        <NewQuestionnaireForm
          countries={countries}
          regulations={regulations}
          sources={sources}
        />
      )}
    </main>
  );
}
