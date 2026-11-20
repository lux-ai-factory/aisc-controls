"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

/** A server action a form posts to, answering a refusal with its reason. */
type FormAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * One button that changes a submission (archive, restore, discard): a refusal is said beside it, instead
 * of on the app's generic error page.
 */
export function ActionButton({
  action,
  label,
  className = "btn",
}: {
  action: FormAction;
  label: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <form action={formAction}>
      {state?.error && <div className="error">{state.error}</div>}
      <button className={className} type="submit" disabled={pending}>
        {label}
      </button>
    </form>
  );
}

/** Amending a final submission: one button makes the next version. A refusal is said above it. */
export function AmendForm({ action, nextVersion }: { action: FormAction; nextVersion: number }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, undefined);
  return (
    <details className="amend" open={state?.error ? true : undefined}>
      <summary className="btn">Amend (makes version {nextVersion})</summary>
      <form action={formAction} className="qf-form">
        {state?.error && <div className="error">{state.error}</div>}
        <div className="qf-actions">
          <button className="btn" type="submit" disabled={pending}>
            Make version {nextVersion}
          </button>
        </div>
      </form>
    </details>
  );
}
