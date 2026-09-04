/**
 * Who is asking, inside a route handler.
 *
 * The middleware has already checked the signature by the time any of this
 * runs, so this is not a second gate — it is how a handler finds out *whose*
 * data to read. The 401 branch exists for the cases middleware doesn't cover
 * and for the day someone edits the matcher.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionUser } from "./auth";

export async function currentUser(): Promise<number | null> {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
}

/**
 * The user id, or a response to return instead.
 *
 * Written as a union rather than a throw so that forgetting to handle the
 * signed-out case is a type error at the call site:
 *
 *     const who = await requireUser();
 *     if ("res" in who) return who.res;
 *     // who.id from here on
 */
export async function requireUser(): Promise<{ id: number } | { res: NextResponse }> {
  const id = await currentUser();
  if (id == null) {
    return { res: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  return { id };
}
