/**
 * The cupboard running itself down.
 * Run with: npx tsx bench/stock.ts
 *
 * Pure checks on `stockNow` — the part that decides which logged meals come
 * out of which count. The database half is thin on purpose so this is the
 * part that can be wrong.
 */
import { stockNow, type Eaten, type StockRow } from "../lib/stock";

let failures = 0;
function check(what: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
}

const meal = (day: string, at: string, items: [string, number][]): Eaten => ({
  day,
  created_at: `${day}T${at}:00.000Z`,
  items: items.map(([name, grams]) => ({ name, grams })),
});

// Bought 1 kg of chicken on Saturday morning; the count is stamped then.
const rows: StockRow[] = [
  { name: "Chicken Breast", grams: 1000, counted_at: "2026-09-19T10:00:00.000Z", counted_on: "2026-09-19" },
  { name: "Bananas", grams: 735, counted_at: "2026-09-19T10:00:00.000Z", counted_on: "2026-09-19" },
  // A figure from before tracking existed.
  { name: "Pasta", grams: 850, counted_at: "2026-09-05T08:00:00.000Z", counted_on: null },
];

const eaten: Eaten[] = [
  // Breakfast before the shop — already out of the cupboard before the count.
  meal("2026-09-19", "07:30", [["Banana", 105]]),
  // Dinner Saturday, Monday and Tuesday.
  meal("2026-09-19", "19:00", [["Chicken Breast", 190], ["White Rice", 120]]),
  meal("2026-09-21", "19:00", [["chicken breasts", 190]]),
  meal("2026-09-22", "08:00", [["Banana", 105]]),
  // Thursday's lunch, typed in late on Saturday after the count — it was
  // eaten before the count, so it must not come off again.
  meal("2026-09-17", "12:00", [["Chicken Breast", 190]]),
  // Pasta eaten all week: a legacy figure isn't run down.
  meal("2026-09-21", "12:00", [["Pasta", 190]]),
];
// The late-typed Thursday meal was created after the count.
eaten[4].created_at = "2026-09-19T15:00:00.000Z";

const out = new Map(stockNow(rows, eaten).map((s) => [s.name, s]));

const chicken = out.get("Chicken Breast")!;
check("chicken: two dinners since the count come off", chicken.grams === 620, `${chicken.grams} g`);
check("…whatever the meal called it", chicken.used === 380, `${chicken.used} g used`);

const banana = out.get("Bananas")!;
check("bananas: breakfast before the shop doesn't come off", banana.grams === 630, `${banana.grams} g`);

const pasta = out.get("Pasta")!;
check("pasta: an old figure stands until it's checked", pasta.grams === 850 && !pasta.tracking, `${pasta.grams} g`);

const none = stockNow(
  [{ name: "Honey", grams: 50, counted_at: "2026-09-19T10:00:00.000Z", counted_on: "2026-09-19" }],
  [meal("2026-09-20", "08:00", [["Honey", 46]]), meal("2026-09-21", "08:00", [["Honey", 46]])]
)[0];
check("it never goes below zero", none.grams === 0, `${none.grams} g`);

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
