import { NextResponse } from "next/server";
import { createSessionToken, passwordMatches, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

/**
 * A deliberately slow, in-memory rate limit. Vercel may run several instances,
 * so this isn't airtight — but combined with a long password it makes
 * brute-forcing the admin door pointless.
 */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 8;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait ten minutes and try again." },
      { status: 429 }
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  if (!process.env.ADMIN_PASSWORD || !process.env.AUTH_SECRET) {
    return NextResponse.json(
      { error: "Admin access isn't configured yet — ADMIN_PASSWORD and AUTH_SECRET need setting." },
      { status: 503 }
    );
  }

  // Deliberate small delay to blunt automated guessing.
  await new Promise((r) => setTimeout(r, 350));

  if (!passwordMatches(password)) {
    return NextResponse.json({ error: "That password isn't right." }, { status: 401 });
  }

  const token = await createSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Could not create a session." }, { status: 500 });
  }

  attempts.delete(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
