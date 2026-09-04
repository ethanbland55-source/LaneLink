import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { deleteAccount, orphanedRows } from "@/lib/accounts";
import { ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Deleting your own account, and only ever your own.
 *
 * A route of its own rather than another verb on `/api/auth`, which already
 * carries sign in, sign up, sign out and change password. `DELETE /api/auth`
 * means sign out — the least destructive thing in the app — and putting the
 * most destructive thing one letter away from it is asking for the wrong one
 * to get called by a stale client or a mistyped fetch.
 *
 * The id comes from the session and is never read from the request, so there
 * is no shape of body that deletes somebody else. The password is required
 * again even though you are already signed in: this is irreversible, and a
 * phone left unlocked on a table should not be enough.
 */
export async function POST(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const body = (await req.json().catch(() => ({}))) as any;
  if (body?.confirm !== "delete") {
    return NextResponse.json({ error: "Not confirmed." }, { status: 400 });
  }

  const done = await deleteAccount(who.id, body?.password);
  if ("error" in done) return NextResponse.json({ error: done.error }, { status: 400 });

  // Nothing left to be signed in as.
  const res = NextResponse.json({ ok: true, rows: done.rows, left: await orphanedRows() });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
