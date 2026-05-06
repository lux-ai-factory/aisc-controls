"use client";

import { useActionState } from "react";
import { submitForm, type SubmitState } from "./actions";

type Q = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

export default function FillForm({
  questionnaireId,
  questions,
}: {
  questionnaireId: string;
  questions: Q[];
}) {
  const action = submitForm.bind(null, questionnaireId);
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(
    action,
    undefined,
  );

  // Group questions by category to mirror the source document.
  const grouped: { category: string | null; items: Q[] }[] = [];
  for (const q of questions) {
    const last = grouped[grouped.length - 1];
    if (last && last.category === q.category) last.items.push(q);
    else grouped.push({ category: q.category, items: [q] });
  }

  return (
    <form action={formAction} className="qf-form">
      {state?.error && <div className="error">{state.error}</div>}

      <section className="qf-section">
        <h2>Submission name</h2>
        <p className="qf-help">
          A short label so you can find this submission later, e.g. "Acme Vision
          v2.4 — internal review".
        </p>
        <div className="field">
          <label htmlFor="label">Label</label>
          <input id="label" name="label" required />
        </div>
      </section>

      {grouped.map((group, gi) => (
        <section key={gi} className="qf-section">
          {group.category && <h2>{group.category}</h2>}
          {group.items.map((q, i) => (
            <div key={q.id} className="field">
              <label htmlFor={`a:${q.id}`}>
                {group.category && (
                  <span className="qf-cat">
                    {group.category} · #{gi === 0 && i === 0 ? "" : ""}
                  </span>
                )}
                {q.article && <span className="tag tag--reg">{q.article}</span>}
                <span className="q-text">{q.text}</span>
              </label>
              <textarea id={`a:${q.id}`} name={`a:${q.id}`} rows={2} />
            </div>
          ))}
        </section>
      ))}

      <div className="qf-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save submission"}
        </button>
      </div>
    </form>
  );
}
