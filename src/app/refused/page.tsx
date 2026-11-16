import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { launcherUrl } from "@/lib/appUrls";
import { REFUSAL_HEADER, isProjectPagePath, readRefusal } from "@/lib/refusal";

/**
 * Where a project page the door refused is shown (the middleware rewrites it here): the platform's reason,
 * the way back to the projects and, when the platform did not answer, the same page to try again.
 */
export default async function RefusedPage() {
  const refusal = readRefusal((await headers()).get(REFUSAL_HEADER));
  if (refusal?.status === 404) notFound();
  const unanswered = refusal?.status === 503;
  const retry = unanswered && refusal && isProjectPagePath(refusal.path) ? refusal.path : null;

  return (
    <>
      <SiteHeader />
      <main className="page">
        <div className="empty-state">
          <h1>{unanswered ? "The platform did not answer" : "You cannot open this page"}</h1>
          <p>{refusal?.message ?? "This page cannot be shown."}</p>
          <div className="library-toolbar">
            {retry && (
              <Link className="btn" href={retry}>
                Try again
              </Link>
            )}
            <a className="btn ghost" href={launcherUrl()}>
              ← Projects
            </a>
          </div>
        </div>
      </main>
    </>
  );
}
