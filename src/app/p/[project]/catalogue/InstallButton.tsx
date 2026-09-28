"use client";

import { useActionState } from "react";
import { installFromCatalogue, type InstallState } from "../install/actions";

/** Install one catalogue checklist into this project, then open it. */
export default function InstallButton({
  project,
  slug,
  disabledReason,
}: {
  project: string;
  slug: string;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState<InstallState, FormData>(
    installFromCatalogue.bind(null, project, slug),
    undefined,
  );
  return (
    <form action={formAction}>
      {state?.error && <div className="error">{state.error}</div>}
      <button type="submit" className="btn" disabled={pending || disabledReason !== null} title={disabledReason ?? undefined}>
        {pending ? "Installing…" : "Install"}
      </button>
    </form>
  );
}
