"use client";
import keycloak from "@/auth/keycloak";

import { useActionState, useState } from "react";
import type { Country, Regulation } from "@/data";
import ChecklistMetaFields, {
  type ChecklistMeta,
  type SourceOption,
} from "@/components/ChecklistMetaFields";
import { saveReviewedQuestions, type SaveState } from "./actions";

type ReviewQuestion = {
  id: string;
  text: string;
  article: string | null;
  category: string | null;
};

export default function ReviewForm({
  checklistId,
  meta,
  questions: initial,
  countries,
  regulations,
  sources,
}: {
  checklistId: string;
  meta: ChecklistMeta;
  questions: ReviewQuestion[];
  countries: Country[];
  regulations: Regulation[];
  sources: SourceOption[];
}) {
  const action = saveReviewedQuestions.bind(null, checklistId);
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    action,
    undefined,
  );
  const [questions, setQuestions] = useState<ReviewQuestion[]>(initial);

  const update = (idx: number, patch: Partial<ReviewQuestion>) =>
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));

  const remove = (idx: number) =>
    setQuestions((prev) => prev.filter((_, i) => i !== idx));

  const move = (idx: number, dir: -1 | 1) =>
    setQuestions((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });

  const addBlank = () =>
    setQuestions((prev) => [
      ...prev,
      { id: `new-${prev.length}`, text: "", article: null, category: null },
    ]);

  return (
    <form action={formAction} className="qf-form">
      <input type="hidden" name="kc_token" value={keycloak.token ?? ""} />
      {state?.error && <div className="error">{state.error}</div>}

      <ChecklistMetaFields
        initial={meta}
        countries={countries}
        regulations={regulations}
        sources={sources}
        fieldErrors={state?.fieldErrors}
      />

      <section className="qf-section">
        <h2>Questions</h2>
        <p className="qf-help">
          Edit, reorder, or delete questions before publishing the template.
          Anything you change here is what users will see when they fill out the
          form.
        </p>

        {state?.fieldErrors?.questions && (
          <div className="error">{state.fieldErrors.questions}</div>
        )}

        <ol className="review-list">
          {questions.map((q, idx) => (
            <li key={q.id} className="review-item">
              <div className="review-meta">
                <span className="review-num">#{idx + 1}</span>
                <div className="review-controls">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => move(idx, 1)}
                    disabled={idx === questions.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    onClick={() => remove(idx)}
                    aria-label="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="field">
                <label>Question text</label>
                <textarea
                  rows={2}
                  name={`q.${idx}.text`}
                  value={q.text}
                  onChange={(e) => update(idx, { text: e.target.value })}
                  required
                />
              </div>
              <div className="qf-row">
                <div className="field">
                  <label>Article / clause</label>
                  <input
                    name={`q.${idx}.article`}
                    value={q.article ?? ""}
                    onChange={(e) =>
                      update(idx, { article: e.target.value || null })
                    }
                    placeholder="e.g. Article 14.4.a"
                  />
                </div>
                <div className="field">
                  <label>Category</label>
                  <input
                    name={`q.${idx}.category`}
                    value={q.category ?? ""}
                    onChange={(e) =>
                      update(idx, { category: e.target.value || null })
                    }
                    placeholder="e.g. Human Oversight"
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>

        <button type="button" className="btn ghost" onClick={addBlank}>
          + Add a question manually
        </button>
      </section>

      <div className="qf-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Publish checklist"}
        </button>
      </div>
    </form>
  );
}
