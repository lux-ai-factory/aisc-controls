"use client";

import { useActionState } from "react";
import { groupByCategory } from "@/lib/questions";
import ScoreScale from "@/components/ScoreScale";
import { submitForm, type SubmitState } from "./actions";
import keycloak from "@/auth/keycloak";

type Q = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

export default function FillForm({
  checklistId,
  questions,
}: {
  checklistId: string;
  questions: Q[];
}) {
  const action = submitForm.bind(null, checklistId);
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(
    action,
    undefined,
  );

  const grouped = groupByCategory(questions);

  return (
    <form action={formAction} className="qf-form">
      {/* Forward the user's Keycloak token so the server action can attribute the audit event to
          the verified user (the server decides `what`; the token only supplies the "who"). */}
      <input type="hidden" name="kc_token" value={keycloak.token ?? ""} />
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
          {group.items.map((q) => (
            <div key={q.id} className="field">
              <label htmlFor={`a:${q.id}`}>
                {group.category && (
                  <span className="qf-cat">{group.category}</span>
                )}
                {q.article && <span className="tag tag--reg">{q.article}</span>}
                <span className="q-text">{q.text}</span>
              </label>
              <textarea id={`a:${q.id}`} name={`a:${q.id}`} rows={2} />
              <ScoreScale questionId={q.id} />
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
