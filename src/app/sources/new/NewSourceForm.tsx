"use client";

import { useActionState } from "react";
import { createSource, type CreateState } from "./actions";

export default function NewSourceForm() {
  const [state, formAction, pending] = useActionState<CreateState, FormData>(
    createSource,
    undefined,
  );

  return (
    <form action={formAction} className="qf-form">
      {state?.error && <div className="error">{state.error}</div>}
      <section className="qf-section">
        <div className="field">
          <label htmlFor="name">Source / authority name</label>
          <input
            id="name"
            name="name"
            placeholder="e.g. AESIA, ENISA, CNIL"
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="citation">Citation (optional)</label>
          <input
            id="citation"
            name="citation"
            placeholder='e.g. "Origin of the data: Spanish Agency for the Supervision of Artificial Intelligence"'
          />
          <span className="qf-help">
            Some authorities require a formal citation when re-using their
            documents. Stored on the source and shown next to every
            questionnaire from this source.
          </span>
        </div>
        <div className="field">
          <label htmlFor="url">Website (optional)</label>
          <input
            id="url"
            name="url"
            type="url"
            placeholder="https://example.gov/page"
          />
          <span className="qf-help">
            Link to the authority's site or the page where the source documents
            were obtained.
          </span>
        </div>
      </section>
      <div className="qf-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Register source"}
        </button>
      </div>
    </form>
  );
}
