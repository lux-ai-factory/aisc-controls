/**
 * The door to a project's pages.
 *
 * Signing in is the gateway's job and has already happened by the time a
 * request arrives here. This answers the other question: is this person in this
 * project, and are they allowed to change it. The platform decides; this asks
 * it once per request and turns the answer into a status.
 *
 * It covers server actions without naming any of them, because an action is a
 * POST to the page it sits on.
 */
import { NextResponse, type NextRequest } from "next/server";

import { admit, projectFromPath } from "@/vendor/aisc-access/projectAccess";
import { tokenFromHeaders } from "@/lib/access/callerToken";
import { platformUrl } from "@/lib/appUrls";

export const config = {
  // Only the pages inside a project. The rest (the root page, /install and its
  // API, the static assets) has nothing project-specific; /install checks the
  // project it is given itself.
  matcher: ["/p/:path*"],
};

export async function middleware(request: NextRequest) {
  const project = projectFromPath(request.nextUrl.pathname);
  if (!project) return NextResponse.next();

  const token = tokenFromHeaders(request.headers) || null;
  const admission = await admit(project, request.method, token, { platformUrl: platformUrl() });
  if (admission.ok) return NextResponse.next();
  return new NextResponse(admission.message, { status: admission.status });
}
