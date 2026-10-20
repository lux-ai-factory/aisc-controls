"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for local debugging / server logs.
    console.error(error);
  }, [error]);

  return (
    <main className="page">
      <div className="empty-state">
        <h1>Something went wrong</h1>
        <p>
          An unexpected error occurred. You can try again, or go back to the
          projects.
        </p>
        <div className="library-toolbar">
          <button className="btn" type="button" onClick={reset}>
            Try again
          </button>
          {/* A client page cannot read the launcher's address; the app's root redirects there. */}
          <Link className="btn ghost" href="/">
            ← Projects
          </Link>
        </div>
      </div>
    </main>
  );
}
