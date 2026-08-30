import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  credentialsOk,
  issueSession,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Sign in. The password is never compared anywhere the browser can reach. */
export async function POST(req: Request) {
  const { user, password } = await req.json().catch(() => ({}) as any);

  if (!credentialsOk(user, password)) {
    // One message for a wrong name and a wrong password alike: telling someone
    // which half they got right is telling them half the answer.
    return NextResponse.json({ error: "That's not right." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await issueSession(), {
    httpOnly: true,
    sameSite: "lax",
    // Vercel is https; localhost isn't, and a secure cookie there never sticks.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
