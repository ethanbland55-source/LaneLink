import { NextResponse } from "next/server";
import { SESSION_COOKIE, issueSession, usingDefaults } from "@/lib/auth";
import {
  accountById,
  changePassword,
  listAccounts,
  renameAccount,
  signIn,
  signUp,
} from "@/lib/accounts";
import { ensureSchema } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * This route is outside the middleware's matcher, because it is the door.
 *
 * That makes it the one place in the app where an unauthenticated request can
 * reach the database, so it does exactly two things for a stranger: check a
 * password, and create an account. Everything else here reads the session
 * first.
 */

function withSession(userId: number, body: Record<string, unknown>) {
  const res = NextResponse.json(body);
  return issueSession(userId).then((value) => {
    res.cookies.set(SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      // Vercel is https; localhost isn't, and a secure cookie there never sticks.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Deliberately no maxAge, which makes this a *session* cookie: closing
      // the app signs you out. The signed payload carries its own expiry as the
      // backstop for a phone that suspends the app rather than closing it.
    });
    return res;
  });
}

/**
 * Who you are, for the corner of the screen.
 *
 * Worth having even on a single-user install: the moment two people can use
 * the same address, "whose plan am I looking at" stops being a rhetorical
 * question, and finding out by recognising the food is not good enough.
 */
export async function GET() {
  await ensureSchema();
  try {
    const id = await currentUser();
    if (id == null) return NextResponse.json({ me: null });
    const [me, all] = await Promise.all([accountById(id), listAccounts()]);
    return NextResponse.json({
      me,
      others: Math.max(0, all.length - 1),
      // Worth surfacing now that accounts exist: without AUTH_SECRET the
      // session signature uses a constant that is printed in lib/auth.ts, so
      // anyone who can read the source can mint a cookie for any account.
      weakSecret: usingDefaults(),
    });
  } catch {
    return NextResponse.json({ me: null });
  }
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = (await req.json().catch(() => ({}))) as any;

  if (body?.action === "signup") {
    const made = await signUp(body.user, body.password, body.display_name);
    if ("error" in made) return NextResponse.json({ error: made.error }, { status: 400 });
    return withSession(made.account.id, { ok: true, account: made.account });
  }

  const account = await signIn(body?.user, body?.password);
  if (!account) {
    // One message for a wrong name and a wrong password alike: telling someone
    // which half they got right is telling them half the answer.
    return NextResponse.json({ error: "That's not right." }, { status: 401 });
  }
  return withSession(account.id, { ok: true, account });
}

/** Change your own password, or your own display name. */
export async function PUT(req: Request) {
  await ensureSchema();
  const id = await currentUser();
  if (id == null) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as any;

  if (typeof body?.display_name === "string") {
    await renameAccount(id, body.display_name);
  }

  if (body?.password != null) {
    const done = await changePassword(id, body.current, body.password);
    if ("error" in done) return NextResponse.json({ error: done.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
