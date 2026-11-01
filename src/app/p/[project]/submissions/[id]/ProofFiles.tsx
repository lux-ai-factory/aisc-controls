"use client";

/**
 * The files that prove one question's answer: each with its size, who attached it and when, and a download
 * link; on a draft, Attach and Remove. Attach and Remove call this app's route handlers
 * (questions/[question]/files), then refresh the page, which keeps what was typed in the form around it.
 * Every control here is a plain button, never a submit: the list sits inside the draft's form.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { formatDateTime } from "@/lib/formatDate";
import { formatSize, MAX_FILES_PER_QUESTION, type ProofLink } from "@/lib/proofFiles";

/** The header the route handlers want, which a form posted from another site cannot send. */
const OWN_PAGE = { "x-requested-with": "aisc-controls" };

export default function ProofFiles({
  basePath,
  project,
  submissionId,
  questionId,
  files,
  editable,
}: {
  basePath: string;
  project: string;
  submissionId: string;
  questionId: string;
  files: ProofLink[];
  editable: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `${basePath}/p/${project}/submissions/${submissionId}/questions/${encodeURIComponent(questionId)}/files`;

  if (!editable && files.length === 0) return null;

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: OWN_PAGE });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `The file could not be changed (${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("The app could not be reached. Try again in a moment.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function attach(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    void send(base, { method: "POST", body });
  }

  return (
    <div className="proof-files">
      <p className="meta">Proof files</p>
      {files.length > 0 && (
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              <a href={`${base}/${f.id}`} download>
                {f.name}
              </a>{" "}
              <span className="meta" suppressHydrationWarning>
                {formatSize(f.size)} · {f.uploadedBy ?? "uploader not recorded"} · {formatDateTime(new Date(f.uploadedAt))}
              </span>
              {editable && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void send(`${base}/${f.id}`, { method: "DELETE" })}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && files.length < MAX_FILES_PER_QUESTION && (
        <>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Working…" : "Attach file"}
          </button>
          {/* no name: the draft's form around it never sends the file */}
          <input ref={input} type="file" hidden onChange={(e) => attach(e.target.files?.[0])} />
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
