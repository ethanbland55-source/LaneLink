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
};

/**
 * Neon's driver returns rows as a plain array. node-postgres returns a result
 * object. Everything in lib/ treats the return value as an array, so the shim
 * has to as well or half the code silently sees `undefined`.
 */
function makeSql(client: Client): Sql {
  const fn = async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    let text = "";
    strings.forEach((part, i) => {
      text += part;
      if (i < vals.length) text += `$${i + 1}`;
    });
    const res = await client.query(text, vals as any[]);
    return res.rows;
  };
  (fn as Sql).client = client;
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
