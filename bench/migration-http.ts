/**
 * The migration, over the driver that actually runs it.
 *
 * Run: PGTEST=postgres://... npx tsx bench/migration-http.ts
 */
import { neon, neonConfig } from "@neondatabase/serverless";
import { startNeonProxy, statementCount } from "./neon-proxy";
import { __setSql } from "../lib/db";
import { Client } from "pg";

const url = process.env.PGTEST;
if (!url) { console.log("PGTEST not set — skipping."); process.exit(0); }

async function main() {
  // Wipe first, using an ordinary connection.
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("drop schema if exists public cascade");
  await c.query("create schema public");
  await c.end();

  const proxy = await startNeonProxy(url!);
  neonConfig.fetchEndpoint = proxy.url;
  const sql = neon("postgresql://u:p@localhost/db", { fullResults: false });
  __setSql(sql as any);

  const { ensureSchema } = await import("../lib/db");
  console.log("Running the whole migration over the HTTP driver...\n");
  try {
    await ensureSchema();
    console.log("PASS — the migration completes over the HTTP driver.");
  } catch (e: any) {
    console.log("FAIL — the migration threw:\n");
    console.log("  " + (e?.message ?? String(e)));
    console.log("\n  sourceError:", e?.sourceError?.message ?? "—");
    await proxy.close();
    process.exit(1);
  }
  await proxy.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
