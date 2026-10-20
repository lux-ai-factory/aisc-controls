"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { groupByCategory } from "@/lib/questions";
import ScoreScale from "@/components/ScoreScale";
import { formatTime } from "@/lib/formatDate";
import { useLeaveGuard } from "@/lib/useLeaveGuard";
import { saveDraft, type ActionState } from "./actions";

type Q = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

export default function DraftEditForm({
  project,
  submissionId,
  label,
  questions,
  answersByQ,
  scoresByQ,
}: {
  project: string;
  submissionId: string;
  label: string;
  questions: Q[];
  answersByQ: Record<string, string>;
  scoresByQ: Record<string, number>;
}) {
  const action = saveDraft.bind(null, project, submissionId);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useLeaveGuard(formRef, pending, state?.savedAt);

  const grouped = groupByCategory(questions);

  return (
    <form ref={formRef} action={formAction} className="qf-form">
      {state?.error && <div className="error">{state.error}</div>}
      {/* the browser formats it, so the time is the reader's own */}
      {state?.savedAt && (
        <p className="info-banner">Draft saved at {formatTime(new Date(state.savedAt))}</p>
      )}

      <section className="qf-section">
        <h2>Name</h2>
        <div className="field">
          <label htmlFor="label">Name</label>
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
        <Link className="btn ghost" href={`/p/${project}/submissions`}>
          Cancel
        </Link>
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
          {pending ? "Saving…" : "Finalise submission"}
        </button>
      </div>
    </form>
  );
}
