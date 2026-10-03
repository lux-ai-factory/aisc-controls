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

import { decide, fetchAccess, projectFromPath, READ_ONLY } from "@/lib/access/projectAccess";
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
  const access = await fetchAccess(project, token, { platformUrl: platformUrl() });

  switch (decide(request.method, access)) {
    case "allow":
      return NextResponse.next();
    case "not-found":
      return new NextResponse("No such project.", { status: 404 });
    case "forbidden":
      return new NextResponse(READ_ONLY, { status: 403 });
    case "unavailable":
      return new NextResponse("The platform is not answering, so who may be here cannot be established.", {
        status: 503,
      });
  }
}
