import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "otters_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours — a gala day, then sign out.

function secret(): Uint8Array | null {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) return null;
  return new TextEncoder().encode(raw);
}

/** Constant-time password comparison so timing can't be used to guess it. */
export function passwordMatches(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // Compare lengths separately, then bytes — timingSafeEqual throws on mismatch.
  if (a.length !== b.length) {
    // Still burn a comparison so the failure takes a similar amount of time.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function createSessionToken(): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const key = secret();
  if (!key || !token) return false;
  try {
    const { payload } = await jwtVerify(token, key);
    return payload.role === "admin";
  } catch {
    return false;
  }
}

/** Is the current request from a signed-in admin? */
export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

/** Whether an admin password has been configured at all. */
export const adminConfigured = Boolean(process.env.ADMIN_PASSWORD && process.env.AUTH_SECRET);
