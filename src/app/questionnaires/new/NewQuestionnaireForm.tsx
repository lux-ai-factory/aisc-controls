"use client";

import { useActionState } from "react";
import type { Country, Regulation } from "@/data";
import QuestionnaireMetaFields, {
  type SourceOption,
} from "@/components/QuestionnaireMetaFields";
import { ingestQuestionnaire, type IngestState } from "./actions";

export default function NewQuestionnaireForm({
  countries,
  regulations,
  sources,
}: {
  countries: Country[];
  regulations: Regulation[];
  sources: SourceOption[];
}) {
  const [state, formAction, pending] = useActionState<IngestState, FormData>(
    ingestQuestionnaire,
    undefined,
  );

  return (
    <form action={formAction} className="qf-form">
      {state?.error && <div className="error">{state.error}</div>}
      {pending && (
        <div className="info-banner">
          Parsing the document and extracting questions — this can take 10–60
          seconds. Please wait…
        </div>
      )}

      <QuestionnaireMetaFields
        countries={countries}
        regulations={regulations}
        sources={sources}
        fieldErrors={state?.fieldErrors}
      />

      <section className="qf-section">
        <h2>Source document</h2>
        <p className="qf-help">
          Accepted: <code>.docx</code>, <code>.xlsx</code>, <code>.csv</code>,{" "}
          <code>.txt</code>, <code>.md</code> (max 25 MB).
        </p>
        <div className="field">
          <label htmlFor="file">File</label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".docx,.xlsx,.xls,.csv,.txt,.md"
            required
          />
          {state?.fieldErrors?.file && (
            <span className="field-error">{state.fieldErrors.file}</span>
          )}
        </div>
      </section>

      <div className="qf-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Extracting…" : "Upload & extract questions"}
        </button>
      </div>
    </form>
  );
}
