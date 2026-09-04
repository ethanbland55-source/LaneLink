import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Which build is actually serving this request.
 *
 * Deliberately outside the sign-in wall — see the middleware matcher. It says
 * nothing an asset URL doesn't already say, and a stale *sign-in* page is
 * every bit as broken as a stale plan page: it posts to a route that has moved
 * and the button appears to do nothing.
 *
 * No database, no session, no schema check. This gets polled, and a version
 * endpoint that costs a query is a version endpoint you end up turning off.
 */
export async function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
