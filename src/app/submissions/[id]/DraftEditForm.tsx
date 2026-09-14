"use client";

import { useActionState } from "react";
import { groupByCategory } from "@/lib/questions";
import ScoreScale from "@/components/ScoreScale";
import { saveDraft, type ActionState } from "./actions";

type Q = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

export default function DraftEditForm({
  submissionId,
  label,
  questions,
  answersByQ,
  scoresByQ,
}: {
  submissionId: string;
  label: string;
  questions: Q[];
  answersByQ: Record<string, string>;
  scoresByQ: Record<string, number>;
}) {
  const action = saveDraft.bind(null, submissionId);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    undefined,
  );

  const grouped = groupByCategory(questions);

  return (
    <form action={formAction} className="qf-form">
      {state?.error && <div className="error">{state.error}</div>}

      <section className="qf-section">
        <h2>Submission name</h2>
        <div className="field">
          <label htmlFor="label">Label</label>
          <input id="label" name="label" defaultValue={label} required />
        </div>
      </section>

      {grouped.map((group, gi) => (
        <section key={gi} className="qf-section">
          {group.category && <h2>{group.category}</h2>}
          {group.items.map((q) => {
            const currentScore = scoresByQ[q.id];
            return (
              <div key={q.id} className="field">
                <label htmlFor={`a:${q.id}`}>
                  {q.article && (
                    <span className="tag tag--reg">{q.article}</span>
                  )}
                  <span className="q-text">{q.text}</span>
                </label>
                <textarea
                  id={`a:${q.id}`}
                  name={`a:${q.id}`}
                  rows={3}
                  defaultValue={answersByQ[q.id] ?? ""}
                />
                <ScoreScale questionId={q.id} currentScore={currentScore} />
              </div>
            );
          })}
        </section>
      ))}

      <div className="qf-actions">
        <button
          className="btn ghost"
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save draft"}
        </button>
        <button
          className="btn"
          type="submit"
          name="intent"
          value="close"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save & close checklist"}
        </button>
      </div>
    </form>
  );
}
