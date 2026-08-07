/**
 * Connection check.
 *
 *   npm run test:supabase
 *
 * Confirms both Supabase keys work the way the site needs them to: the
 * publishable key can read published content, and the secret key can write.
 * Worth running after changing keys or environment variables.
 */

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

// Read .env directly so this works without a framework around it.
const env: Record<string, string> = {};
for (const line of (await readFile(new URL("../.env", import.meta.url), "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

console.log(`\nProject: ${url}`);
console.log(`Publishable: ${publishable?.slice(0, 22)}…`);
console.log(`Secret:      ${secret?.slice(0, 18)}…\n`);

let failed = false;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { console.error(`  ✗ ${m}`); failed = true; };

/* ---- Public reads --------------------------------------------------------- */

console.log("Publishable key (what the browser gets):");
const pub = createClient(url, publishable, { auth: { persistSession: false } });

const { data: series, error: seriesError } = await pub.from("gala_series").select("slug");
if (seriesError) bad(`read gala_series — ${seriesError.message}`);
else ok(`read gala_series (${series?.length ?? 0} rows)`);

// Row Level Security should stop the public key writing anything.
const { error: blocked } = await pub.from("gala_series").insert({ slug: "rls-probe", name: "probe" });
if (blocked) ok(`writes correctly blocked by Row Level Security`);
else {
  bad("PUBLIC KEY COULD WRITE — Row Level Security is not protecting this table");
  await pub.from("gala_series").delete().eq("slug", "rls-probe");
}

/* ---- Admin writes --------------------------------------------------------- */

console.log("\nSecret key (what the admin area writes with):");
const admin = createClient(url, secret, { auth: { persistSession: false } });

const { error: readError } = await admin.from("site_settings").select("key").limit(1);
if (readError) bad(`read site_settings — ${readError.message}`);
else ok("read site_settings");

const probe = { slug: "connection-probe", name: "Connection probe", sort_order: 999, published: false };
const { error: writeError } = await admin.from("gala_series").insert(probe);
if (writeError) bad(`write gala_series — ${writeError.message}`);
else {
  ok("write gala_series");
  const { error: deleteError } = await admin.from("gala_series").delete().eq("slug", probe.slug);
  if (deleteError) bad(`clean up probe row — ${deleteError.message}`);
  else ok("delete gala_series (probe removed)");
}

/* ---- Storage -------------------------------------------------------------- */

console.log("\nStorage:");
const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
if (bucketError) bad(`list buckets — ${bucketError.message}`);
else if (!buckets?.some((b) => b.id === "otters")) bad("the 'otters' bucket is missing");
else ok("'otters' bucket present");

console.log();
if (failed) {
  console.error("Connection check FAILED.\n");
  process.exit(1);
}
console.log("✓ Supabase is wired up correctly.\n");
