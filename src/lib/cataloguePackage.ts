/**
 * A control from the catalogue, as the package installChecklist stores.
 *
 * There is one catalogue, hosted online. It is fetched server-side, never by
 * the browser: the page the button sits on only ever sends the slug.
 */
import { bearer, withoutTrailingSlash } from "@/lib/http";

// Runs of - or _ are allowed: four of the catalogue's controls have "---" in
// their slug. Slashes, dots and spaces never are, so a slug stays one path segment.
const SLUG = /^[a-z0-9]+(?:[-_]+[a-z0-9]+)*$/i;

const NOT_ANSWERING = "The catalogue is not answering. Nothing was installed.";

export type Fetched = { ok: true; pkg: unknown } | { ok: false; reason: string };

export async function fetchCataloguePackage(
  slug: string,
  opts: { baseUrl?: string; token?: string; fetchImpl?: typeof fetch } = {},
): Promise<Fetched> {
  if (!SLUG.test(slug)) return { ok: false, reason: "That is not the name of a catalogue control." };
  const base = withoutTrailingSlash(opts.baseUrl ?? process.env.CATALOGUE_URL ?? "");
  const token = opts.token ?? process.env.CATALOGUE_TOKEN ?? "";
  if (!base) return { ok: false, reason: "This install does not know where the catalogue is." };
  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(`${base}/control/${encodeURIComponent(slug)}/export`, {
      cache: "no-store",
      headers: bearer(token),
    });
  } catch {
    return { ok: false, reason: NOT_ANSWERING };
  }
  if (response.status === 404) return { ok: false, reason: `The catalogue has no control called “${slug}”.` };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "The catalogue refused this platform: check CATALOGUE_TOKEN. Nothing was installed." };
  }
  if (!response.ok) return { ok: false, reason: NOT_ANSWERING };
  try {
    return { ok: true, pkg: await response.json() };
  } catch {
    // A 200 that is not JSON: a proxy's error page, a login page, a wrong URL.
    return { ok: false, reason: "The catalogue sent something that is not a control package. Nothing was installed." };
  }
}
