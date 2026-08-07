import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Gate everything under /admin (except the login screen) on a valid session
 * cookie. Runs before any admin page renders, so an unauthenticated request
 * never reaches a component that could leak data.
 *
 * (Next 16 renamed this file convention from `middleware` to `proxy`.)
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") return NextResponse.next();

  const token = request.cookies.get("otters_admin")?.value;
  const secret = process.env.AUTH_SECRET;

  if (token && secret && secret.length >= 16) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      if (payload.role === "admin") return NextResponse.next();
    } catch {
      // Invalid or expired token — fall through to the redirect.
    }
  }

  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*"],
};
