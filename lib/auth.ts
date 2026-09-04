/**
 * The front door, and who came through it.
 *
 * This used to be one password for one person. It is now one account each: the
 * cookie says *which* account, and every query in the app is filtered by it, so
 * two people using the same install never see a gram of each other's food.
 *
 * What is in this file is deliberately only the cryptography — signing a
 * session, checking one, hashing a password. It has no database import, because
 * the middleware runs on the edge and imports it on every single request; a
 * session check that had to ask Postgres who you were would put a round trip in
 * front of every page load for no benefit. The signature is the proof.
 *
 * `lib/accounts.ts` is the half that talks to the database.
 *
 * ## What this is and isn't
 *
 * Passwords are stored as PBKDF2-HMAC-SHA256 with a per-account salt at the
 * iteration count OWASP currently suggests, and compared in constant time. That
 * is a real password store, not a doorstop. It is still worth being plain about
 * the limits: there is no rate limiting, no second factor, and no password
 * reset that doesn't go through you. Set `AUTH_SECRET` in the environment or
 * the session signature falls back to a constant that is in this file, and
 * anyone reading it can mint a cookie for any account.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "mealhub_session";

/**
 * The outside limit on a session, in seconds.
 *
 * Twelve hours, and the cookie is written *without* a `Max-Age` on top of
 * that, which makes it a session cookie — the browser drops it when the app is
 * genuinely closed. This signed expiry is the backstop for the case a browser
 * doesn't treat as a close: an iOS home-screen app that gets suspended rather
 * than terminated can sit on a session cookie for days.
 */
export const SESSION_MAX_AGE = 60 * 60 * 12;

/**
 * How long the app may sit in the background before it re-locks, in seconds.
 *
 * Ten minutes. Fifteen seconds was the original figure and it was wrong for
 * how this actually gets used: you check a recipe, reply to a message, put the
 * kettle on, come back — and you are typing a password again to find out how
 * many carbs are left. A lock that fires on every glance away is one you start
 * resenting, and the thing people do about that is stop locking at all.
 *
 * Ten minutes still covers the case this exists for. It is not a bank; the
 * risk is somebody picking up your unlocked phone, and after ten minutes the
 * phone's own lock has almost certainly beaten us to it anyway. The signed
 * twelve-hour expiry and the session cookie are the other two backstops.
 *
 * Set `NEXT_PUBLIC_LOCK_AFTER=0` to lock the instant you look away.
 */
export const LOCK_AFTER_SECONDS = Number(process.env.NEXT_PUBLIC_LOCK_AFTER ?? 600);

/**
 * Falls back to a constant so the app runs out of the box. That fallback is
 * public knowledge, which is exactly why `usingDefaults()` exists and why the
 * sign-in page says so.
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

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/** The cookie value for a session that starts now, for this account. */
export async function issueSession(userId: number): Promise<string> {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${await hmac(payload)}`;
}

/**
 * Who this cookie says you are, or null.
 *
 * Rejects anything it doesn't recognise rather than throwing, because a
 * mangled cookie is a request to sign in again, not an error to show someone.
 * Cookies issued before accounts existed carried a username where the id now
 * goes, so they fail the number check and ask for one more sign-in. That is
 * the correct outcome and not worth a compatibility path.
 */
export async function sessionUser(value: string | undefined | null): Promise<number | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, expires, sig] = parts;

  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const ms = Number(expires);
  if (!Number.isFinite(ms) || ms < Date.now()) return null;

  return sameString(sig, await hmac(`${id}.${expires}`)) ? userId : null;
}

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

/**
 * PBKDF2-HMAC-SHA256, 210,000 iterations.
 *
 * Web Crypto rather than node:crypto's scrypt on purpose: it is the one API
 * available on both runtimes this app can be deployed on, so there is a single
 * code path and no chance of the edge build quietly failing to hash. 210,000
 * is OWASP's current figure for this construction. scrypt would be stronger
 * against dedicated hardware; for a meal planner shared with a handful of
 * teammates, this is the right place on the curve.
 */
const PBKDF2_ITERATIONS = 210_000;

export function newSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256
  );
  return hex(bits);
}

export async function passwordMatches(
  password: string,
  salt: string,
  expected: string
): Promise<boolean> {
  return sameString(await hashPassword(password, salt), expected);
}

/* ------------------------------------------------------------------ */
/* What a name and a password have to be                               */
/* ------------------------------------------------------------------ */

/** Letters, digits and the two separators people actually type. */
export const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{1,23}$/;

/**
 * The longest password we'll take. Not a policy — a bound.
 *
 * Every rule below this line was deleted on purpose: no minimum length, no
 * required character classes, nothing to satisfy. Composition rules are a
 * poor proxy for strength — they push people towards `Password1!` and towards
 * reusing the one string that satisfies every site — and NIST dropped them
 * from SP 800-63B for exactly that reason. The browser's own generator makes
 * a far better password than any rule can force, and it is one tap away.
 *
 * This cap stays because it is about the request rather than the person: a
 * megabyte of "a" is a way to make the server do pointless work, and nobody's
 * passphrase is a thousand characters.
 */
export const PASSWORD_MAX = 1024;

/** Why a sign-up was refused, in words meant for the person typing. */
export function checkUsername(name: unknown): string | null {
  if (typeof name !== "string") return "Pick a username.";
  const v = name.trim().toLowerCase();
  if (v.length < 2) return "Usernames are at least 2 characters.";
  if (v.length > 24) return "Usernames are at most 24 characters.";
  if (!USERNAME_RULE.test(v)) {
    return "Letters and numbers, plus dot, dash and underscore. Start with a letter or number.";
  }
  return null;
}

/**
 * Whatever you want, as long as it's something.
 *
 * The only check left is that there is one. An empty password isn't a password
 * you chose, it's an account with no password on it, and the sign-in form would
 * have no way to tell the two apart.
 *
 * Existing passwords are untouched by this — they are salted hashes and the
 * rules were never stored alongside them, so nothing needs migrating and
 * nobody gets asked to change anything.
 */
export function checkPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) return "Pick a password.";
  if (password.length > PASSWORD_MAX) return "That's longer than the box will take.";
  return null;
}

export function normaliseUsername(name: string): string {
  return name.trim().toLowerCase();
}

/** True while the session signature is still the one printed in this file. */
export function usingDefaults(): boolean {
  return !process.env.AUTH_SECRET;
}
