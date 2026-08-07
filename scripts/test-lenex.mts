/**
 * Smoke test for the Lenex parser.
 *
 *   npm run test:lenex                      → uses scripts/sample-meet.lef
 *   npm run test:lenex -- path/to/real.lxf  → uses a real Meet Organisation export
 *
 * Run this against a genuine export before the first gala. If the numbers below
 * match the printed results sheet, the import will be right too.
 */

import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { parseLenex } from "../src/lib/lenex.ts";

const target = process.argv[2] ?? resolve(import.meta.dirname, "sample-meet.lef");

const buffer = await readFile(target);
const meet = await parseLenex(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  basename(target)
);

const line = (label: string, value: unknown) =>
  console.log(`  ${label.padEnd(22)} ${String(value)}`);

console.log(`\n=== ${meet.name} ===`);
line("Venue", meet.venue ?? "—");
line("Course", meet.course ?? "—");
line("Dates", [meet.startDate, meet.endDate].filter(Boolean).join(" → ") || "—");
line("Sessions", meet.sessions.length);
line("Events", meet.events.length);
line("Results", meet.results.length);
line("Clubs", meet.clubs.join(", ") || "—");

if (meet.warnings.length) {
  console.log("\n  Warnings:");
  for (const w of meet.warnings) console.log(`   ! ${w}`);
}

console.log("\n--- Sessions ---");
for (const s of meet.sessions) {
  console.log(
    `  ${String(s.number).padStart(2)}. ${(s.name ?? "").padEnd(22)} ${s.date ?? ""} ` +
    `warm-up ${s.warmupTime ?? "—"} start ${s.startTime ?? "—"}`
  );
}

console.log("\n--- Events & results ---");
for (const event of meet.events) {
  const rows = meet.results
    .filter((r) => r.lenexEventId === event.lenexId)
    .sort((a, b) => {
      if (a.status && !b.status) return 1;
      if (!a.status && b.status) return -1;
      return (a.place ?? 99) - (b.place ?? 99);
    });

  console.log(
    `\n  ${event.number} ${event.name}` +
    `${event.ageGroup ? `  [${event.ageGroup}]` : ""}` +
    `  (session ${event.sessionNumber}, ${event.round}${event.isRelay ? ", relay" : ""})`
  );

  if (!rows.length) {
    console.log("      no results");
    continue;
  }

  for (const r of rows) {
    const place = r.status ? "  –" : `${String(r.place ?? "?").padStart(3)}`;
    const time = r.status ? r.status : (r.swimTime ?? "—");
    console.log(
      `    ${place}. ${r.swimmerName.padEnd(24)} ${(r.club ?? "").padEnd(20)}` +
      ` ${time.padStart(9)} ${r.points ? `${r.points}pts` : ""}`
    );
    if (r.splits.length) {
      console.log(`         splits: ${r.splits.map((s) => `${s.distance}m ${s.time}`).join("  ")}`);
    }
    if (r.relayMembers?.length) {
      console.log(`         team:   ${r.relayMembers.map((m) => m.name).join(", ")}`);
    }
  }
}

/* ---- Assertions ---------------------------------------------------------- */

const problems: string[] = [];
if (!meet.sessions.length) problems.push("no sessions parsed");
if (!meet.events.length) problems.push("no events parsed");
if (!meet.results.length) problems.push("no results parsed");
if (meet.results.some((r) => !r.swimmerName)) problems.push("a result has no swimmer name");
if (meet.results.some((r) => !r.status && r.swimTime === null)) {
  problems.push("a finisher has no time");
}

console.log();
if (problems.length) {
  console.error("FAILED:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("✓ Parser looks healthy.\n");
