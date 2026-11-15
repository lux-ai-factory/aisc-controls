/**
 * The catalogue's install dialog asks here what it would install and where (GET). The install itself is
 * posted under the project it goes into (app/p/[project]/api/install): only there does the gateway bind the
 * request to that project, so only there is the install recorded in the project's ledger.
 */
import { installOptions } from "@/lib/installControl";
import { allowedOrigin, reply } from "@/lib/installApi";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { ok, origin } = allowedOrigin(request);
  if (!ok) return reply({ error: "Only the catalogue may ask." }, 403, null);
  const url = new URL(request.url);
  const result = await installOptions(url.searchParams.get("slug")?.trim() ?? "", url.searchParams.get("project"));
  if (!result.ok) return reply({ error: result.error }, result.status, origin);
  const { ok: _ok, ...options } = result;
  return reply(options, 200, origin);
}

/** An install posted here could not be recorded, so it is refused before anything is installed. */
export async function POST(request: Request): Promise<Response> {
  const { ok, origin } = allowedOrigin(request);
  if (!ok) return reply({ error: "Only the catalogue may install." }, 403, null);
  return reply({ error: "This install address is no longer used. Reload the catalogue and install again. Nothing was installed." },
    410, origin);
}
