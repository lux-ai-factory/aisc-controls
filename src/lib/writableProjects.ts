/**
 * The projects this person may install into: the ones they may change.
 *
 * Asked of the platform, which is the one place that knows who is in what.
 * An admin's list comes without roles, because an admin may act on every
 * project.
 */
import { bearer, withoutTrailingSlash } from "@/lib/http";

export type ProjectChoice = { pid: string; name: string };

const WRITERS = new Set(["editor", "owner"]);

export async function writableProjects(
  token: string | null,
  opts: { platformUrl: string; fetchImpl?: typeof fetch },
): Promise<ProjectChoice[] | null> {
  const platformUrl = withoutTrailingSlash(opts.platformUrl);
  if (!platformUrl) return null;
  try {
    const response = await (opts.fetchImpl ?? fetch)(`${platformUrl}/projects`, {
      headers: bearer(token),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ pid: string; name: string; role?: string }>;
    return rows
      .filter((r) => r.role === undefined || WRITERS.has(r.role))
      .map((r) => ({ pid: r.pid, name: r.name }));
  } catch {
    return null;
  }
}
