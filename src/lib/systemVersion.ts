/**
 * The AI card version that is the latest for a project, as the platform says.
 *
 * An answer carries it, so a result can be read against the card that was in
 * force when it was given. Never throws: when the platform does not answer, the
 * answer is saved unstamped, and a warning says why.
 */
import { platformUrl } from "@/lib/appUrls";
import { bearer, withoutTrailingSlash } from "@/lib/http";

export async function latestVersion(
  pid: string,
  token: string | null,
): Promise<{ pid: string; number: number } | null> {
  const base = withoutTrailingSlash(platformUrl());
  if (!base) return null;
  try {
    const res = await fetch(`${base}/projects/${encodeURIComponent(pid)}/system-versions/latest`, {
      headers: bearer(token),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`platform answered ${res.status} for the latest version of ${pid}`);
      return null;
    }
    const body = await res.json();
    return body ? { pid: body.pid, number: body.number } : null;
  } catch (err) {
    console.warn(`platform did not answer for the latest version of ${pid}`, err);
    return null;
  }
}
