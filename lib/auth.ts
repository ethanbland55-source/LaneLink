/**
 * The front door.
 *
 * This is a **doorstop, not a lock.** It keeps the page out of the hands of
 * someone who stumbles on the URL, and that is the whole of what it does. The
 * default password is four digits; anyone who wants in is in.
 *
 * It is at least an honest doorstop. The check runs on the server and sets a
 * signed cookie, so it can't be stepped over by editing the page in devtools
 * the way a password compared in the browser can. Set `AUTH_USER` and
 * `AUTH_PASSWORD` in the environment and it becomes a real one — nothing else
 * has to change. Setting `AUTH_SECRET` as well is what makes the cookie
 * unforgeable rather than merely inconvenient to forge.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "mealhub_session";

/** A week. Long enough not to be a nuisance on a phone you own. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export function expectedUser(): string {
  return process.env.AUTH_USER || "admin";
}

export function expectedPassword(): string {
  return process.env.AUTH_PASSWORD || "1234";
}

/**
 * Falls back to a constant so the app runs out of the box. That fallback is
 * public knowledge, which is exactly why the docstring above calls this a
 * doorstop — set AUTH_SECRET and it stops being one.
 */
function secret(): string {
  return process.env.AUTH_SECRET || "meal-hub-unset-secret";
}

/** Constant-time compare, so the check leaks nothing through its timing. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cookie value for a session that starts now. */
export async function issueSession(): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${expectedUser()}.${expires}`;
  return `${payload}.${await hmac(payload)}`;
}

/**
 * Is this cookie one we issued, and still in date?
 *
 * Rejects anything it doesn't recognise rather than throwing, because a
 * mangled cookie is a request to sign in again, not an error to show someone.
 */
export async function validSession(value: string | undefined | null): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [user, expires, sig] = parts;
  if (!sameString(user, expectedUser())) return false;

  const ms = Number(expires);
  if (!Number.isFinite(ms) || ms < Date.now()) return false;

  return sameString(sig, await hmac(`${user}.${expires}`));
}

/** Whether the credentials typed on the sign-in page are the right ones. */
export function credentialsOk(user: unknown, password: unknown): boolean {
  return (
    typeof user === "string" &&
    typeof password === "string" &&
    sameString(user.trim(), expectedUser()) &&
    sameString(password, expectedPassword())
  );
}

/** True while the defaults are still in place — the UI says so rather than pretending. */
export function usingDefaults(): boolean {
  return !process.env.AUTH_PASSWORD || !process.env.AUTH_SECRET;
}
