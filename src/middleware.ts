/**
 * The door to a project's pages.
 *
 * Signing in is the gateway's job and has already happened by the time a
 * request arrives here. This answers the other question: is this person in this
 * project, and are they allowed to change it. The platform decides; this asks
 * it once per request and turns the answer into a status.
 *
 * A server action is a POST to the page it sits on; it is let through to the
 * action, which checks for itself. A refused page is shown as this app's refused page, with the platform's
 * reason (rewritten there, so the address stays the one the person opened).
 */
import { NextResponse, type NextRequest } from "next/server";

import { admit, projectFromPath } from "@/vendor/aisc-access/projectAccess";
import { tokenFromHeaders } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";
import { REFUSAL_HEADER, refusalHeaderValue } from "@/lib/refusal";

export const config = {
  // Only the pages inside a project. The rest (the root page, /install and its
  // API, the static assets) has nothing project-specific; /install checks the
  // project it is given itself.
  matcher: ["/p/:path*"],
};

const READS = new Set(["GET", "HEAD"]);

export async function middleware(request: NextRequest) {
  const project = projectFromPath(request.nextUrl.pathname);
  if (!project) return NextResponse.next();

  const token = tokenFromHeaders(request.headers) || null;
  const admission = await admit(project, request.method, token, { platformUrl: platformUrl() });
  if (admission.ok) return NextResponse.next();
  // A form (a server action) goes on to its action, which asks the platform again before it changes
  // anything (projectDbFor) and answers the refusal in the form's own state: the form keeps what was typed
  // and says why. Answered here, the browser would get a text it cannot read and show a generic error.
  if (request.method === "POST" && request.headers.has("next-action")) return NextResponse.next();
  // Anything else but a page (an upload, the install API) keeps a short answer its caller reads.
  if (!READS.has(request.method)) return new NextResponse(admission.message, { status: admission.status });

  const refused = request.nextUrl.clone();
  refused.pathname = "/refused";
  refused.search = "";
  const forwarded = new Headers(request.headers);
  forwarded.set(REFUSAL_HEADER, refusalHeaderValue({
    status: admission.status,
    message: admission.message,
    path: request.nextUrl.pathname + request.nextUrl.search,
  }));
  return NextResponse.rewrite(refused, { request: { headers: forwarded } });
}
