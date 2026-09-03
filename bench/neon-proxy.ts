/**
 * A stand-in for Neon's HTTP endpoint, so the production driver can be tested.
 *
 * `bench/db-harness.ts` swaps the driver out for node-postgres, which proves
 * the *SQL* is right. It does not prove the SQL survives the driver that
 * actually runs it. Neon's serverless driver does not open a connection: it
 * POSTs one statement at a time to an HTTP endpoint, and that endpoint has its
 * own rules about what a statement may be. A migration can be perfectly good
 * Postgres and still fail there.
 *
 * That gap is exactly where the last outage came from, so this closes it. It
 * speaks the same protocol — POST /sql with `{query, params}`, answer with
 * `{fields, rows, rowCount, command}` — and forwards to a local Postgres.
 *
 * It deliberately enforces the one restriction the real endpoint has and an
 * ordinary connection doesn't: **one statement per request**. That is the
 * difference that matters, and a proxy that quietly allowed two would be
 * worse than no proxy at all.
 */

import * as http from "http";
import { Client } from "pg";

/**
 * The endpoint returns rows as arrays of values, not objects.
 *
 * The driver zips them back up against `fields`. Returning objects instead
 * looks like it works right up until the driver does `row.map(...)` and falls
 * over with something that mentions neither rows nor fields — so getting this
 * detail right is most of what makes the proxy worth having.
 */
function shape(r: { fields?: any[]; rows?: any[]; command?: string; rowCount?: number | null }) {
  const fields = (r.fields ?? []).map((f) => ({
    name: f.name,
    dataTypeID: f.dataTypeID,
    tableID: f.tableID,
    columnID: f.columnID,
    dataTypeSize: f.dataTypeSize,
    dataTypeModifier: f.dataTypeModifier,
    format: "text",
  }));
  const names = fields.map((f) => f.name);
  return {
    command: r.command,
    rowCount: r.rowCount,
    fields,
    rows: (r.rows ?? []).map((row: any) => names.map((n) => row[n])),
  };
}

export type Proxy = {
  url: string;
  /** HTTP requests served — the number the migration is actually judged on. */
  requests: () => number;
  close: () => Promise<void>;
};

/** Statements the real HTTP endpoint refuses, because it manages its own. */
const FORBIDDEN = /^\s*(begin|commit|rollback|start\s+transaction)\b/i;

/**
 * Does this look like more than one statement?
 *
 * Semicolons inside dollar-quoted blocks and string literals don't count, which
 * is the whole subtlety — a `DO $$ begin ... end $$` block is full of them and
 * is nonetheless a single statement.
 */
export function statementCount(sqlText: string): number {
  let i = 0;
  let n = 1;
  let dollarTag: string | null = null;
  let quote: string | null = null;

  while (i < sqlText.length) {
    const c = sqlText[i];

    if (dollarTag) {
      if (sqlText.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    if (quote) {
      if (c === quote) quote = null;
      i++;
      continue;
    }

    if (c === "'" || c === '"') {
      quote = c;
      i++;
      continue;
    }

    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sqlText.slice(i));
      if (m) {
        dollarTag = m[0];
        i += m[0].length;
        continue;
      }
    }

    if (c === ";") {
      // A trailing semicolon is not a second statement.
      if (sqlText.slice(i + 1).trim().length > 0) n++;
    }
    i++;
  }
  return n;
}

export async function startNeonProxy(pgUrl: string, port = 5599): Promise<Proxy> {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();

  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      try {
        const parsed = JSON.parse(body || "{}");

        /**
         * A batch. This is the shape `sql.transaction([...])` sends, and the
         * reason this proxy exists at all: the whole point of batching the
         * migration is that it becomes one request, and only a proxy that
         * speaks this can prove it did.
         */
        if (Array.isArray(parsed.queries)) {
          const out: unknown[] = [];
          try {
            await client.query("begin");
            for (const q of parsed.queries) {
              if (statementCount(q.query) > 1) {
                throw Object.assign(new Error("cannot insert multiple commands"), {
                  code: "42601",
                });
              }
              const r = await client.query(q.query, q.params ?? []);
              out.push(shape(r as any));
            }
            await client.query("commit");
          } catch (err: any) {
            await client.query("rollback").catch(() => {});
            return send(400, { message: err?.message ?? String(err), code: err?.code });
          }
          // The driver wants `{ results: [...] }`, not a bare array.
          return send(200, { results: out });
        }

        const { query, params } = parsed;
        if (typeof query !== "string") return send(400, { message: "no query" });

        if (FORBIDDEN.test(query)) {
          return send(400, {
            message: "transaction control is not supported over HTTP",
            code: "42601",
          });
        }
        if (statementCount(query) > 1) {
          return send(400, {
            message: "cannot insert multiple commands into a prepared statement",
            code: "42601",
          });
        }

        const r = await client.query(query, params ?? []);
        send(200, shape(r as any));
      } catch (e: any) {
        send(400, { message: e?.message ?? String(e), code: e?.code, severity: "ERROR" });
      }
    });
  });

  await new Promise<void>((r) => server.listen(port, r));

  return {
    url: `http://localhost:${port}/sql`,
    requests: () => requests,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await client.end();
    },
  };
}
