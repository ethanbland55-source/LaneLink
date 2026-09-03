/**
 * Running the real query code against a real Postgres.
 *
 * The staging bug that shipped was not a logic error — every unit of it read
 * correctly. It was that ingredient ids do not survive a save, which is a fact
 * about the *database*, and no amount of reasoning about the TypeScript was
 * ever going to surface it. So the tests that matter for anything holding SQL
 * have to talk to a database.
 *
 * `lib/db.ts` exports a `sql` tagged template built on Neon's HTTP driver,
 * which only speaks to Neon. This swaps in an identically-shaped one backed by
 * node-postgres, by putting it in the module cache before anything imports it.
 * The code under test is then the real code, unmodified — which is the whole
 * point; a harness that required production code to know about it would be
 * testing a different program.
 *
 *   PGTEST=postgres://... npx tsx bench/<name>.ts
 */

import { Client } from "pg";
import { __setSql } from "../lib/db";

export type Sql = ((strings: TemplateStringsArray, ...vals: unknown[]) => Promise<any[]>) & {
  client: Client;
  transaction: (queries: any[]) => Promise<any[]>;
};

/**
 * A faithful stand-in for Neon's tagged template, including its laziness.
 *
 * Two details matter and both were wrong at first, which quietly invalidated
 * every test that used this:
 *
 *  - **Neon returns rows as a plain array**, not node-postgres's result object.
 *    Everything in lib/ treats the return value as an array, so a shim that
 *    hands back the result object makes half the code see `undefined`.
 *
 *  - **A Neon query does not run until it is awaited.** `lib/db.ts` relies on
 *    that: its collector builds `sql`...`` values and hands the array to
 *    `sql.transaction`, so an eager shim fires all 77 DDL statements
 *    unawaited, `createSchema` throws on the missing `.transaction`, `run()`
 *    swallows it, and the suite ends up testing an unmigrated database while
 *    reporting that everything passed. Which is exactly what happened.
 */
type Lazy = PromiseLike<any[]> & { __q: { text: string; values: unknown[] } };

function makeSql(client: Client): Sql {
  const build = (strings: TemplateStringsArray, vals: unknown[]) => {
    let text = "";
    strings.forEach((part, i) => {
      text += part;
      if (i < vals.length) text += `$${i + 1}`;
    });
    return { text, values: vals };
  };

  const run = (q: { text: string; values: unknown[] }) =>
    client.query(q.text, q.values as any[]).then((r) => r.rows);

  const fn: any = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = build(strings, vals);
    const lazy: Lazy = {
      __q: q,
      then: (res: any, rej: any) => run(q).then(res, rej),
    } as Lazy;
    (lazy as any).catch = (rej: any) => run(q).catch(rej);
    (lazy as any).finally = (f: any) => run(q).finally(f);
    return lazy;
  };

  /** What `sql.transaction([...])` does: one round trip, all or nothing. */
  fn.transaction = async (queries: Lazy[]) => {
    const out: any[] = [];
    await client.query("begin");
    try {
      for (const q of queries) out.push(await run(q.__q));
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    }
    return out;
  };

  fn.client = client;
  return fn as Sql;
}

/**
 * Point `lib/db` at a local Postgres.
 *
 * Only the driver is replaced. `ensureSchema` and the whole migration stay
 * real and run against this connection, which is the point: a schema change
 * that only works on a database that already has the table is exactly the kind
 * of thing this is here to catch.
 */
export async function connect(url: string): Promise<{ sql: Sql; client: Client }> {
  const client = new Client({ connectionString: url });
  await client.connect();
  const sql = makeSql(client);
  __setSql(sql as any);
  return { sql, client };
}

/** A clean database, so one test can never explain another one's result. */
export async function reset(sql: Sql): Promise<void> {
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
}

let failures = 0;
export function check(what: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
}
export function done(): never {
  console.log(
    failures === 0
      ? "\nPASS — every check held."
      : `\nFAIL — ${failures} check${failures === 1 ? "" : "s"} did not hold.`
  );
  process.exit(failures === 0 ? 0 : 1);
}
