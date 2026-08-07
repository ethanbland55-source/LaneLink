/**
 * Smoke test for the SPORTSYSTEMS web-results parser.
 *
 *   npm run test:sportsys                    → downloads real Aquatics GB files
 *   npm run test:sportsys -- C:\path\to\dir  → parses a local `webpages` folder
 *
 * Point it at a folder from one of your own meets to confirm the live ingest
 * will read your files correctly before you rely on it on gala day.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSportsysFilename, parseSportsysHtml } from "../src/lib/sportsys.ts";

const REMOTE_BASE = "https://results.swimming.org/swimming/results/2026/agbnextgen/";
const REMOTE_SAMPLES = ["RW3H202.HTM", "RM6H101.HTM", "SM17H201.HTM", "RM17F251.HTM"];

const localDir = process.argv[2];

type Sample = { name: string; html: string };
const samples: Sample[] = [];

if (localDir) {
  const files = await readdir(localDir);
  for (const f of files.filter((f) => /^[RS].*\.htm$/i.test(f)).slice(0, 12)) {
    samples.push({ name: f, html: await readFile(join(localDir, f), "latin1") });
  }
  console.log(`Reading ${samples.length} file(s) from ${localDir}\n`);
} else {
  console.log("Downloading sample files from Aquatics GB…\n");
  for (const name of REMOTE_SAMPLES) {
    const res = await fetch(REMOTE_BASE + name);
    if (!res.ok) { console.error(`  ! ${name}: HTTP ${res.status}`); continue; }
    samples.push({ name, html: await res.text() });
  }
}

if (!samples.length) {
  console.error("No files to parse.");
  process.exit(1);
}

let problems = 0;

for (const { name, html } of samples) {
  const meta = parseSportsysFilename(name);
  const parsed = parseSportsysHtml(html, name);

  console.log(`=== ${name} ===`);
  console.log(`  filename → kind=${meta.kind} event=${meta.eventNumber} gender=${meta.gender} round=${meta.round}`);
  console.log(`  content  → "${parsed.eventName}" round=${parsed.round} blocks=${parsed.blocks.length} rows=${parsed.totalRows}`);

  if (meta.eventNumber === null) { console.error("  ✗ could not read an event number"); problems++; }
  if (!parsed.totalRows) { console.error("  ✗ no rows parsed"); problems++; }

  for (const block of parsed.blocks) {
    console.log(`  -- ${block.ageGroup ?? "(no age group)"} — ${block.rows.length} rows`);
    for (const r of block.rows.slice(0, 4)) {
      const place = r.status ? "  –" : String(r.place ?? "?").padStart(3);
      console.log(
        `     ${place}. ${r.swimmerName.padEnd(24)} ${(r.club ?? "").padEnd(16)}` +
        ` ${(r.status || r.swimTime || "—").padStart(9)}` +
        `${r.points ? `  ${r.points}pts` : ""}` +
        `${r.splits.length ? `  [${r.splits.map((s) => `${s.distance}:${s.time}`).join(" ")}]` : ""}`
      );
    }
    if (block.rows.length > 4) console.log(`     … ${block.rows.length - 4} more`);

    // Every finisher should have a time; anyone without one should have a status.
    const bad = block.rows.filter((r) => !r.status && !r.swimTime);
    if (bad.length) {
      console.error(`  ✗ ${bad.length} row(s) with neither a time nor a status, e.g. "${bad[0].swimmerName}"`);
      problems++;
    }
  }
  console.log();
}

if (problems) {
  console.error(`FAILED with ${problems} problem(s).\n`);
  process.exit(1);
}
console.log("✓ Parser looks healthy.\n");
