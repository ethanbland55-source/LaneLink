/**
 * Accounts, and what a new one starts with.
 *
 * The app was built for one person and every table said so. Making room for a
 * second is mostly bookkeeping — a `user_id` on everything, a filter on every
 * query — but there is one design decision worth stating, because getting it
 * wrong is the kind of bug that is embarrassing rather than merely broken:
 *
 * **The user id is never optional and never defaulted.** Every function that
 * touches owned data takes it as its first argument, and there is no fallback
 * to "the first user" anywhere. A route that forgets to pass it does not
 * quietly read Ethan's dinner; it fails to compile. That is worth the extra
 * parameter on eighty function signatures.
 *
 * A new account is not an empty one. Someone who signs up and finds a blank
 * screen has no way to tell a working app from a broken one, so signing up
 * seeds the three kinds of day and a profile with sensible defaults, and drops
 * them on the Plan page to put their own food in.
 */

import { sql } from "./db";
import { checkPassword, checkUsername, hashPassword, newSalt, normaliseUsername, passwordMatches } from "./auth";

export type Account = {
  id: number;
  username: string;
  display_name: string;
  created_at: string;
};

function toAccount(r: any): Account {
  return {
    id: Number(r.id),
    username: String(r.username),
    display_name: String(r.display_name ?? r.username),
    created_at: String(r.created_at ?? ""),
  };
}

export async function findAccount(username: string): Promise<Account | null> {
  const rows = (await sql`
    select id, username, display_name, created_at
      from users where username = ${normaliseUsername(username)}`) as any[];
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function accountById(id: number): Promise<Account | null> {
  const rows = (await sql`
    select id, username, display_name, created_at from users where id = ${id}`) as any[];
  return rows[0] ? toAccount(rows[0]) : null;
}

/** Everyone with an account, for the "switch account" list. Names only. */
export async function listAccounts(): Promise<{ id: number; display_name: string }[]> {
  const rows = (await sql`
    select id, display_name from users order by id`) as any[];
  return rows.map((r) => ({ id: Number(r.id), display_name: String(r.display_name) }));
}

/**
 * Check a password. Returns the account, or null for both "no such user" and
 * "wrong password" — telling someone which half they got right is telling them
 * half the answer.
 */
export async function signIn(username: unknown, password: unknown): Promise<Account | null> {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const rows = (await sql`
    select id, username, display_name, created_at, pw_hash, pw_salt
      from users where username = ${normaliseUsername(username)}`) as any[];
  const row = rows[0];
  if (!row) {
    // Still do the work, so a missing account and a wrong password take about
    // the same time and the response can't be used to enumerate names.
    await hashPassword(password, "absent");
    return null;
  }
  const ok = await passwordMatches(password, String(row.pw_salt), String(row.pw_hash));
  if (!ok) return null;
  await sql`update users set last_seen = now() where id = ${row.id}`;
  return toAccount(row);
}

export type SignUpResult = { account: Account } | { error: string };

/**
 * Create an account and give it something to look at.
 *
 * The seed is deliberately the shape of a week rather than a list of food:
 * three kinds of day, a sensible profile, and nothing on the plate. Food is
 * personal and guessing at it would only be something to delete; the week
 * structure is the part that is fiddly to build from nothing.
 */
export async function signUp(
  username: unknown,
  password: unknown,
  displayName: unknown
): Promise<SignUpResult> {
  const nameError = checkUsername(username);
  if (nameError) return { error: nameError };
  const pwError = checkPassword(password);
  if (pwError) return { error: pwError };

  const uname = normaliseUsername(username as string);
  if (await findAccount(uname)) return { error: "That username is taken." };

  const shown =
    typeof displayName === "string" && displayName.trim()
      ? displayName.trim().slice(0, 40)
      : uname;

  const salt = newSalt();
  const hash = await hashPassword(password as string, salt);

  const rows = (await sql`
    insert into users (username, display_name, pw_hash, pw_salt)
    values (${uname}, ${shown}, ${hash}, ${salt})
    on conflict (username) do nothing
    returning id, username, display_name, created_at`) as any[];

  // Lost a race with another sign-up for the same name.
  if (!rows[0]) return { error: "That username is taken." };

  const account = toAccount(rows[0]);
  await seedAccount(account.id);
  return { account };
}

export async function changePassword(
  userId: number,
  current: unknown,
  next: unknown
): Promise<{ error: string } | { ok: true }> {
  const pwError = checkPassword(next);
  if (pwError) return { error: pwError };

  const rows = (await sql`select pw_hash, pw_salt from users where id = ${userId}`) as any[];
  const row = rows[0];
  if (!row) return { error: "No such account." };
  if (typeof current !== "string" || !(await passwordMatches(current, String(row.pw_salt), String(row.pw_hash)))) {
    return { error: "That isn't your current password." };
  }

  const salt = newSalt();
  const hash = await hashPassword(next as string, salt);
  await sql`update users set pw_hash = ${hash}, pw_salt = ${salt} where id = ${userId}`;
  return { ok: true };
}

/**
 * Delete an account and everything it owns.
 *
 * Written out table by table rather than looped, and deliberately not left to
 * `on delete cascade`. Two reasons, and the second is the one that matters:
 *
 *  - Most of these tables have no foreign key to `users` at all. `user_id` was
 *    added as a plain column with a default, precisely so that existing rows
 *    didn't need a backfill — which means the database has no idea these rows
 *    belong to anybody, and would happily leave every one of them behind.
 *  - A list you can read is a list you can check. This is the one operation in
 *    the app that cannot be undone, and "did we get all of it?" should be
 *    answerable by looking rather than by trusting a loop over a constant.
 *
 * Children before parents, so an interrupted run leaves orphans rather than
 * dangling references. The row count comes back so the caller can say what
 * actually went.
 *
 * The last account is refused. `ensureOwner` recreates account 1 from the
 * environment on the next page load, so deleting the only one doesn't empty
 * the app — it silently replaces you with a stranger who has your username and
 * whatever `AUTH_PASSWORD` happens to be. That is a worse outcome than a
 * refusal, and much harder to understand after the fact.
 */
export async function deleteAccount(
  userId: number,
  password: unknown
): Promise<{ error: string } | { ok: true; rows: number }> {
  const rows = (await sql`
    select pw_hash, pw_salt from users where id = ${userId}`) as any[];
  const row = rows[0];
  if (!row) return { error: "No such account." };

  if (
    typeof password !== "string" ||
    !(await passwordMatches(password, String(row.pw_salt), String(row.pw_hash)))
  ) {
    return { error: "That isn't your password." };
  }

  const [{ n }] = (await sql`select count(*)::int as n from users`) as any[];
  if (Number(n) <= 1) {
    return {
      error:
        "This is the only account. Delete it and the app just makes a new owner on the next load — make another account first if you're handing it over.",
    };
  }

  let gone = 0;
  const ran = async (rs: unknown) => {
    gone += Array.isArray(rs) ? rs.length : 0;
  };

  await ran(await sql`delete from ingredients where user_id = ${userId} returning 1`);
  await ran(await sql`delete from pending_portions where user_id = ${userId} returning 1`);
  await ran(await sql`delete from portion_history where user_id = ${userId} returning 1`);
  await ran(await sql`delete from cheat_meals where user_id = ${userId} returning 1`);
  await ran(await sql`delete from supplement_log where user_id = ${userId} returning 1`);
  await ran(await sql`delete from supplements where user_id = ${userId} returning 1`);
  await ran(await sql`delete from log_entries where user_id = ${userId} returning 1`);
  await ran(await sql`delete from weigh_ins where user_id = ${userId} returning 1`);
  await ran(await sql`delete from pantry where user_id = ${userId} returning 1`);
  await ran(await sql`delete from shop_checks where user_id = ${userId} returning 1`);
  await ran(await sql`delete from meals where user_id = ${userId} returning 1`);
  await ran(await sql`delete from day_types where user_id = ${userId} returning 1`);
  await ran(await sql`delete from profile where id = ${userId} returning 1`);
  await ran(await sql`delete from users where id = ${userId} returning 1`);

  return { ok: true, rows: gone };
}

/** Anything still tagged to an account that no longer exists. Zero, or a bug. */
export async function orphanedRows(): Promise<{ table: string; n: number }[]> {
  const rows = (await sql`
    select 'ingredients' as t, count(*)::int as n from ingredients i
      where not exists (select 1 from users u where u.id = i.user_id)
    union all select 'meals', count(*)::int from meals x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'day_types', count(*)::int from day_types x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'log_entries', count(*)::int from log_entries x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'weigh_ins', count(*)::int from weigh_ins x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'supplements', count(*)::int from supplements x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'supplement_log', count(*)::int from supplement_log x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'pantry', count(*)::int from pantry x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'shop_checks', count(*)::int from shop_checks x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'pending_portions', count(*)::int from pending_portions x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'portion_history', count(*)::int from portion_history x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'cheat_meals', count(*)::int from cheat_meals x
      where not exists (select 1 from users u where u.id = x.user_id)
    union all select 'profile', count(*)::int from profile p
      where not exists (select 1 from users u where u.id = p.id)`) as any[];
  return rows.map((r) => ({ table: String(r.t), n: Number(r.n) })).filter((r) => r.n > 0);
}

export async function renameAccount(userId: number, displayName: unknown): Promise<void> {
  const shown = typeof displayName === "string" ? displayName.trim().slice(0, 40) : "";
  if (!shown) return;
  await sql`update users set display_name = ${shown} where id = ${userId}`;
}

/* ------------------------------------------------------------------ */
/* What a new account starts with                                      */
/* ------------------------------------------------------------------ */

/**
 * The three kinds of day almost everyone actually has.
 *
 * Not five. The app shipped with a "gym only" and a "double swim" that nobody
 * ever put in their week, and an unused day type is not free — it shows up in
 * every picker and every table for the life of the account. Someone who needs
 * a fourth can add one in about ten seconds.
 */
const SEED_DAY_TYPES: { name: string; sessions: unknown[] }[] = [
  { name: "Rest", sessions: [] },
  {
    // Deliberately the generic sport rather than a swim. This app was written
    // for a swimmer, and seeding "Swim — main set, 90 min" for someone who
    // signed up to track their running would be the app telling them what
    // they do. `sport` at a moderate level reads as "Training, 60 min", which
    // is a starting point rather than an assumption; the picker has swim,
    // run, cycle and the rest for when they say what it actually is.
    name: "Training",
    sessions: [{ activity: "sport", level: "moderate", met: 7, minutes: 60 }],
  },
  {
    name: "Training + gym",
    sessions: [
      { activity: "sport", level: "moderate", met: 7, minutes: 60 },
      { activity: "gym", level: "moderate", met: 5, minutes: 45 },
    ],
  },
];

export async function seedAccount(userId: number): Promise<void> {
  /**
   * Maintenance, not cutting.
   *
   * The `goal` column defaults to 'cut', which is what this app was for on the
   * day it was written — and 'cut' means twenty per cent below maintenance. So
   * a new account that never opened the settings was silently on an aggressive
   * deficit, with nothing on screen saying it had chosen that for them. A
   * default that makes a decision this size on someone's behalf is a bug, not
   * a default. Maintenance is the honest answer to a question nobody asked
   * yet, and it is one tap to change.
   */
  /**
   * Fat at 0.9 g/kg rather than the 0.8 the goal suggests.
   *
   * Protein and fat lean toward the days that earn them, so a rest day gets a
   * shade less fat than the average — and at 0.8 that lands the lightest day
   * at 18% of calories, under the 20% floor the app itself warns about. A new
   * account would open on a plan it was already complaining about, which reads
   * as the app being broken rather than as advice. 0.9 keeps every day inside
   * the 20–35% guidance, and is still a modest amount of fat.
   */
  await sql`
    insert into profile (id, goal, protein_basis, protein_per_kg, fat_per_kg,
                         phase_start_adjust, phase_end_adjust)
    values (${userId}, 'maintain', 'bodyweight', 2.0, 0.9, 0, 0)
    on conflict (id) do nothing`;

  const existing = (await sql`
    select id from day_types where user_id = ${userId} limit 1`) as any[];
  if (existing.length) return;

  const made: number[] = [];
  for (let i = 0; i < SEED_DAY_TYPES.length; i++) {
    const d = SEED_DAY_TYPES[i];
    const rows = (await sql`
      insert into day_types (user_id, name, sort_order, sessions)
      values (${userId}, ${d.name}, ${i}, ${JSON.stringify(d.sessions)}::jsonb)
      returning id`) as any[];
    made.push(Number(rows[0].id));
  }

  // Weekdays training, weekend lighter — a starting point, not a prescription.
  const [rest, training, both] = made;
  const week = { mon: both, tue: training, wed: training, thu: both, fri: training, sat: rest, sun: rest };
  await sql`
    update profile
       set week_ids = ${JSON.stringify(week)}::jsonb,
           energy_model = 'sessions',
           cycling = true
     where id = ${userId}`;
}
