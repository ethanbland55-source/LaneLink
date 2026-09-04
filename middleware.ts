import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionUser } from "./lib/auth";

/**
 * Everything is behind the door except the door itself.
 *
 * The API routes are covered too, which is the half that matters: a login
 * that only hides the pages leaves `/api/meals` sitting open, and the pages
 * are just a way of looking at that.
 */
export async function middleware(req: NextRequest) {
  const user = await sessionUser(req.cookies.get(SESSION_COOKIE)?.value);
  if (user != null) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Come back to where you were trying to go, not to the home page.
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Everything except the sign-in page, the route that signs you in, and
     * Next's own static assets — which have to stay reachable or the sign-in
     * page has no stylesheet to render itself with.
     */
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
