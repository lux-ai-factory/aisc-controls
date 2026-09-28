/**
 * The controls the catalogue offers, for the in-app catalogue page.
 *
 * The catalogue's list has tools and controls together and no filter for
 * either, so a control is an approved entry stored under /controls/. Each one
 * is then installed by its slug, through fetchCataloguePackage, like any other.
 */
import { bearer, withoutTrailingSlash } from "@/lib/http";

export type CatalogueControl = { slug: string; name: string; description: string | null };

export type Listed = { ok: true; controls: CatalogueControl[] } | { ok: false; reason: string };

const NOT_ANSWERING = "The catalogue is not answering, so its checklists cannot be listed.";

type Entry = { slug?: unknown; name?: unknown; description?: unknown; status?: unknown; storage_path?: unknown };

export async function fetchCatalogueControls(
  opts: { baseUrl?: string; token?: string; fetchImpl?: typeof fetch } = {},
): Promise<Listed> {
  const base = withoutTrailingSlash(opts.baseUrl ?? process.env.CATALOGUE_URL ?? "");
  const token = opts.token ?? process.env.CATALOGUE_TOKEN ?? "";
  if (!base) return { ok: false, reason: "This install does not know where the catalogue is." };
  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(`${base}/tool/`, { cache: "no-store", headers: bearer(token) });
  } catch {
    return { ok: false, reason: NOT_ANSWERING };
  }
  if (!response.ok) return { ok: false, reason: NOT_ANSWERING };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!Array.isArray(body)) return { ok: false, reason: "The catalogue sent something that is not a list of checklists." };

  const controls = (body as Entry[])
    .filter(
      (e) =>
        typeof e.slug === "string" &&
        typeof e.name === "string" &&
        e.status === "approved" &&
        typeof e.storage_path === "string" &&
        e.storage_path.startsWith("/controls/"),
    )
    .map((e) => ({
      slug: e.slug as string,
      name: e.name as string,
      description: typeof e.description === "string" && e.description ? e.description : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { ok: true, controls };
}
