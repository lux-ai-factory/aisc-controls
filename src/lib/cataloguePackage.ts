/**
 * A control of a project's catalogue, as the package installChecklist stores.
 *
 * The platform knows which catalogue the project chose, the public one or its
 * private copy, and gives the package from it
 * (`GET {PLATFORM_URL}/projects/{pid}/catalogue/control/{slug}/export`, with the
 * person's sign-in). This app never names a catalogue itself. It is fetched
 * server-side, never by the browser: the page the button sits on only ever
 * sends the slug and the project.
 */
import { platformUrl } from "@/lib/appUrls";
import { bearer, withoutTrailingSlash } from "@/lib/http";
import { PROJECT_ID } from "@/lib/projectDb";

// Runs of - or _ are allowed: four of the catalogue's controls have "---" in
// their slug. Slashes, dots and spaces never are, so a slug stays one path segment.
const SLUG = /^[a-z0-9]+(?:[-_]+[a-z0-9]+)*$/i;

const NOT_ANSWERING = "The catalogue is not answering. Nothing was installed.";

/** A failure carries the HTTP status that says what kind it is. */
export type Fetched = { ok: true; pkg: unknown } | { ok: false; status: number; reason: string };

const refused = (status: number, reason: string): Fetched => ({ ok: false, status, reason });

export async function fetchCataloguePackage(
  project: string,
  slug: string,
  opts: { platformUrl?: string; token?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<Fetched> {
  if (!PROJECT_ID.test(project)) return refused(400, "Choose a project.");
  if (!SLUG.test(slug)) return refused(404, "That is not the name of a catalogue control.");
  const base = withoutTrailingSlash(opts.platformUrl ?? platformUrl());
  if (!base) return refused(502, "This install does not know where the platform is.");
  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(
      `${base}/projects/${encodeURIComponent(project)}/catalogue/control/${encodeURIComponent(slug)}/export`,
      { cache: "no-store", headers: bearer(opts.token ?? null) },
    );
  } catch {
    return refused(502, NOT_ANSWERING);
  }
  if (response.status === 404) return refused(404, `This project's catalogue has no control called “${slug}”.`);
  if (response.status === 409) {
    // the project has not chosen its catalogue: the platform says what to do
    const detail = await response.json().then((b) => b?.detail).catch(() => null);
    return refused(409, `${typeof detail === "string" ? detail : "This project has no catalogue yet"}. Nothing was installed.`);
  }
  if (response.status === 401 || response.status === 403) {
    return refused(403, "The platform refused to give this control: sign in again. Nothing was installed.");
  }
  if (!response.ok) return refused(502, NOT_ANSWERING);
  try {
    return { ok: true, pkg: await response.json() };
  } catch {
    // A 200 that is not JSON: a proxy's error page, a login page, a wrong URL.
    return refused(502, "The catalogue sent something that is not a control package. Nothing was installed.");
  }
}
