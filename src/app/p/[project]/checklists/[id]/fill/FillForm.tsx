"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { groupByCategory } from "@/lib/questions";
import ScoreScale from "@/components/ScoreScale";
import { useLeaveGuard } from "@/lib/useLeaveGuard";
import { submitForm, type SubmitState } from "./actions";

type Q = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

export default function FillForm({
  project,
  checklistId,
  questions,
}: {
  project: string;
  checklistId: string;
  questions: Q[];
}) {
  const action = submitForm.bind(null, project, checklistId);
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(
    action,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useLeaveGuard(formRef, pending);

  const grouped = groupByCategory(questions);

  return (
    <form ref={formRef} action={formAction} className="qf-form">
      {state?.error && <div className="error">{state.error}</div>}

      <section className="qf-section">
        <h2>Name</h2>
        <p className="qf-help">
          A short name so you can find this submission later, e.g. "Acme Vision
          v2.4, internal review".
        </p>
        <div className="field">
          <label htmlFor="label">Name</label>
          <input id="label" name="label" required />
        </div>
      </section>

      {grouped.map((group, gi) => (
        <section key={gi} className="qf-section">
          {group.category && <h2>{group.category}</h2>}
          {group.items.map((q) => (
            <div key={q.id} className="field">
              <label htmlFor={`a:${q.id}`}>
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
        <Link className="btn ghost" href={`/p/${project}/checklists`}>
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save as draft"}
        </button>
      </div>
    </form>
  );
}
