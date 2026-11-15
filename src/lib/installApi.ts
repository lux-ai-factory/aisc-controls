/**
 * What the catalogue's install dialog calls, from the browser, with the person's sign-in: the offer
 * (app/api/install, GET) and the install itself, under the project it goes into
 * (app/p/[project]/api/install, POST).
 *
 * Only the catalogue's pages may call them: the online catalogue's origin (CATALOGUE_ORIGIN) and the
 * launcher's (the origin of LAUNCHER_URL), where the stack serves the catalogue's pages for a project. Both
 * requests are "simple" (a GET, and a POST of form fields), so the browser sends no preflight the gateway
 * would have to let through unsigned; the Origin check is what stops any other page from installing on
 * somebody's behalf.
 */
import { withoutTrailingSlash } from "@/lib/http";

/** The origin (scheme, host and port) of an address, or null when it is not an absolute http(s) URL. */
function originOf(address: string | undefined): string | null {
  try {
    const url = new URL(address ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function allowedOrigin(request: Request): { ok: boolean; origin: string | null } {
  const origin = request.headers.get("origin");
  const allowed = [withoutTrailingSlash(process.env.CATALOGUE_ORIGIN ?? ""), originOf(process.env.LAUNCHER_URL)]
    .filter((o): o is string => !!o);
  return { ok: origin !== null && allowed.includes(origin), origin };
}

export function reply(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({ "content-type": "application/json", vary: "Origin", "cache-control": "no-store" });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }
  return new Response(JSON.stringify(body), { status, headers });
}
