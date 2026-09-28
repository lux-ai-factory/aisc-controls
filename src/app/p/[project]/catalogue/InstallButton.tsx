"use client";

import Link from "next/link";
import { useActionState } from "react";
import { installHere, type InstallHereState } from "./actions";

/** Install one catalogue checklist into this project, staying on the page. */
export default function InstallButton({
  project,
  slug,
  disabledReason,
}: {
  project: string;
  slug: string;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState<InstallHereState, FormData>(
    installHere.bind(null, project, slug),
    undefined,
  );
  if (state?.installed) {
    return (
      <>
        <span className="tag">Installed</span>
        <Link className="btn ghost" href={state.installed}>
          Open
        </Link>
      </>
    );
  }
  return (
    <form action={formAction}>
      {state?.error && <div className="error">{state.error}</div>}
      <button type="submit" className="btn" disabled={pending || disabledReason !== null} title={disabledReason ?? undefined}>
        {pending ? "Installing…" : "Install"}
      </button>
    </form>
  );
}
