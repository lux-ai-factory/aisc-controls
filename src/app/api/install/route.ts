/**
 * The catalogue's own install dialog talks to this, from the browser, with the
 * person's sign-in: so a control is installed without leaving the catalogue.
 *
 * Only the catalogue's pages may call it: the online catalogue's origin
 * (CATALOGUE_ORIGIN) and the launcher's (the origin of LAUNCHER_URL), where the
 * stack serves the catalogue's pages for a project. Both requests are
 * "simple" (a GET, and a POST of form fields), so the browser sends no
 * preflight the gateway would have to let through unsigned; the Origin check
 * below is what stops any other page from installing on somebody's behalf.
 */
import { withoutTrailingSlash } from "@/lib/http";
import { installForCaller, installOptions } from "@/lib/installControl";
import { emitEvent } from "@/lib/ledger/emit";
import { installedEvent } from "@/lib/ledger/install";

export const dynamic = "force-dynamic";

/** The origin (scheme, host and port) of an address, or null when it is not an absolute http(s) URL. */
function originOf(address: string | undefined): string | null {
  try {
    const url = new URL(address ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function allowedOrigin(request: Request): { ok: boolean; origin: string | null } {
  const origin = request.headers.get("origin");
  const allowed = [withoutTrailingSlash(process.env.CATALOGUE_ORIGIN ?? ""), originOf(process.env.LAUNCHER_URL)]
    .filter((o): o is string => !!o);
  return { ok: origin !== null && allowed.includes(origin), origin };
}

function reply(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({ "content-type": "application/json", vary: "Origin", "cache-control": "no-store" });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export async function GET(request: Request): Promise<Response> {
  const { ok, origin } = allowedOrigin(request);
  if (!ok) return reply({ error: "Only the catalogue may ask." }, 403, null);
  const url = new URL(request.url);
  const result = await installOptions(url.searchParams.get("slug")?.trim() ?? "", url.searchParams.get("project"));
  if (!result.ok) return reply({ error: result.error }, result.status, origin);
  const { ok: _ok, ...options } = result;
  return reply(options, 200, origin);
}

export async function POST(request: Request): Promise<Response> {
  const { ok, origin } = allowedOrigin(request);
  if (!ok) return reply({ error: "Only the catalogue may install." }, 403, null);
  const form = await request.formData();
  const result = await installForCaller(String(form.get("project") ?? ""), String(form.get("slug") ?? "").trim(),
    (tx, installed) => emitEvent(tx, { action: "control.installed", ...installedEvent(installed) }));
  if (!result.ok) return reply({ error: result.error }, result.status, origin);
  const { ok: _ok, ...installed } = result;
  return reply(installed, 200, origin);
}
