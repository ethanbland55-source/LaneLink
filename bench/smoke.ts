/** End-to-end sanity check on the day-type maths and the shopping list. */
import { normaliseProfile } from "../lib/profile";
import { targets, dayMultipliers, WEEKDAYS, type Profile } from "../lib/nutrition";
import { buildShoppingList } from "../lib/shopping";

const profile: Profile = normaliseProfile({
  sex: "male", dob: "2005-03-14", height_cm: 183, weight_kg: 78,
  activity: 1.725, goal: "maintain", protein_per_kg: 2, fat_per_kg: 0.8,
  cycling: true, shop_days: 7, shop_start_dow: 6,
});

const meals = [
  { id: 1, name: "Breakfast", times_per_day: 1, day_types: null, ingredients: [
    { name: "Oats", grams: 100, kcal_100: 379, protein_100: 11, carbs_100: 60, fat_100: 8, fibre_100: 10 },
    { name: "Semi-skimmed milk", grams: 300, kcal_100: 50, protein_100: 3.6, carbs_100: 4.8, fat_100: 1.8, fibre_100: 0 },
    { name: "Banana", grams: 105, kcal_100: 89, protein_100: 1.1, carbs_100: 23, fat_100: 0.3, fibre_100: 2.6 },
  ]},
  { id: 2, name: "Lunch", times_per_day: 1, day_types: null, ingredients: [
    { name: "Chicken breast", grams: 200, kcal_100: 106, protein_100: 24, carbs_100: 0, fat_100: 1.2, fibre_100: 0 },
    { name: "Basmati rice", grams: 120, kcal_100: 349, protein_100: 8.1, carbs_100: 77, fat_100: 1.1, fibre_100: 1.4 },
    { name: "Broccoli", grams: 200, kcal_100: 34, protein_100: 2.8, carbs_100: 4, fat_100: 0.4, fibre_100: 2.6 },
    { name: "Olive oil", grams: 10, kcal_100: 899, protein_100: 0, carbs_100: 0, fat_100: 99.9, fibre_100: 0 },
  ]},
  { id: 3, name: "Pre-swim top-up", times_per_day: 1, day_types: ["session", "double"] as any, ingredients: [
    { name: "Bagel", grams: 85, kcal_100: 270, protein_100: 9, carbs_100: 51, fat_100: 1.5, fibre_100: 2.4 },
    { name: "Honey", grams: 20, kcal_100: 304, protein_100: 0.3, carbs_100: 82, fat_100: 0, fibre_100: 0 },
  ]},
];

console.log("--- week normalisation ---");
const mult = dayMultipliers(profile);
let mean = 0;
for (const d of WEEKDAYS) mean += mult[profile.week[d]];
console.log("week:", WEEKDAYS.map((d) => `${d}:${profile.week[d]}`).join(" "));
console.log("multipliers:", Object.entries(mult).map(([k, v]) => `${k} ${v.toFixed(3)}`).join("  "));
console.log("mean over the week:", (mean / 7).toFixed(4), "(should be 1.0000)");

console.log("\n--- targets by day type ---");
for (const dt of ["rest", "easy", "session", "double"] as const) {
  const t = targets(profile, dt);
  console.log(`${dt.padEnd(8)} ${String(t.kcal).padStart(5)} kcal  P${t.protein} C${t.carbs} F${t.fat} fibre ${t.fibre}`);
}
console.log("flat average:", targets(profile).base, "kcal");

console.log("\n--- 7-day shopping list ---");
const list = buildShoppingList(meals as any, profile, { days: 7, startDay: "2026-08-29" });
console.log("window:", list.startDay, "→", list.endDay, "|", list.totalKg.toFixed(2), "kg");
console.log("day mix:", JSON.stringify(list.dayTypeCounts));
for (const g of list.byAisle) {
  console.log(` ${g.aisle}`);
  for (const l of g.lines) {
    const amt = l.unit ? `${l.unit.count} ${l.unit.name}s` : `${Math.round(l.buyGrams)} g`;
    console.log(`   ${l.name.padEnd(22)} need ${Math.round(l.needGrams).toString().padStart(5)} g  buy ${amt}`);
  }
}
console.log("warnings:", list.warnings);

console.log("\n--- same plan, 10 days ---");
const l10 = buildShoppingList(meals as any, profile, { days: 10, startDay: "2026-08-29" });
console.log(l10.totalKg.toFixed(2), "kg |", l10.lines.length, "lines |", l10.warnings.length, "warnings");
console.log("\n--- with 500 g rice already in ---");
const lp = buildShoppingList(meals as any, profile, { days: 7, startDay: "2026-08-29", pantry: [{ name: "Basmati rice", grams: 500 }] });
const rice = lp.lines.find((l) => l.name.includes("rice"));
console.log("rice:", rice && `need ${Math.round(rice.needGrams)} g, have ${rice.haveGrams}, buy ${rice.buyGrams} g`);
