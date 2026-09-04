/**
 * End-to-end sanity check on day types, the week balance and the shopping list.
 * Run with: npx tsx bench/smoke.ts
 */
import { normaliseProfile } from "../lib/profile";
import {
  SEED_DAY_TYPES,
  WEEKDAYS,
  buildWeekPlan,
  normaliseDayType,
  targetsFor,
  type DayType,
  type Profile,
} from "../lib/nutrition";
import { buildShoppingList } from "../lib/shopping";

const dayTypes: DayType[] = SEED_DAY_TYPES.map((d, i) =>
  normaliseDayType({ ...d, id: i + 1, sort_order: i }, i)
);
const byName = (n: string) => dayTypes.find((d) => d.name === n)!.id;

const profile: Profile = normaliseProfile({
  sex: "male",
  dob: "2005-03-14",
  height_cm: 183,
  weight_kg: 78,
  base_activity: 1.35,
  energy_model: "sessions",
  goal: "maintain",
  protein_per_kg: 2,
  fat_per_kg: 0.8,
  cycling: true,
  shop_days: 7,
  week_ids: {
    mon: byName("Swim only"),
    tue: byName("Swim + gym"),
    wed: byName("Gym only"),
    thu: byName("Swim only"),
    fri: byName("Swim + gym"),
    sat: byName("Double swim"),
    sun: byName("Rest"),
  },
});

const plan = buildWeekPlan(profile, dayTypes);

console.log("--- energy ---");
console.log("BMR", plan.bmr, `(${plan.method})`, "| baseline", plan.baseline);
console.log("average day cost", plan.maintenance, "| goal (7-day average)", plan.goalKcal);
console.log("balance factor", plan.balance.toFixed(4));

console.log("\n--- day types ---");
for (const id of plan.order) {
  const t = targetsFor(plan, id);
  console.log(
    `${t.name.padEnd(13)} cost ${String(t.cost).padStart(4)}  training ${String(t.sessionKcal).padStart(4)}  ` +
      `-> ${String(t.kcal).padStart(4)} kcal  P${t.protein} C${t.carbs} F${t.fat}`
  );
}

const weekMean =
  WEEKDAYS.reduce((a, d) => a + targetsFor(plan, plan.week[d]).kcal, 0) / 7;
console.log(`\nweek average ${weekMean.toFixed(1)} kcal (goal ${plan.goalKcal}) — should match`);

console.log("\n--- pinning a day ---");
const pinned = dayTypes.map((d) => (d.name === "Rest" ? { ...d, fixed_kcal: 2400 } : d));
const p2 = buildWeekPlan(profile, pinned);
const mean2 = WEEKDAYS.reduce((a, d) => a + targetsFor(p2, p2.week[d]).kcal, 0) / 7;
console.log(
  `rest pinned to 2400 -> rest ${targetsFor(p2, byName("Rest")).kcal}, ` +
    `double ${targetsFor(p2, byName("Double swim")).kcal}, week average ${mean2.toFixed(1)}`
);

console.log("\n--- cycling off ---");
const flat = buildWeekPlan({ ...profile, cycling: false }, dayTypes);
console.log("every day:", plan.order.map((id) => targetsFor(flat, id).kcal).join(", "));

console.log("\n--- shopping, 7 days ---");
const meals = [
  {
    id: 1,
    name: "Breakfast",
    times_per_day: 1,
    day_type_ids: null,
    ingredients: [
      { name: "Oats", grams: 100, kcal_100: 379, protein_100: 11, carbs_100: 60, fat_100: 8, fibre_100: 10 },
      { name: "Semi-skimmed milk", grams: 300, kcal_100: 50, protein_100: 3.6, carbs_100: 4.8, fat_100: 1.8, fibre_100: 0 },
    ],
  },
  {
    id: 2,
    name: "Lunch",
    times_per_day: 1,
    day_type_ids: null,
    ingredients: [
      { name: "Chicken breast", grams: 200, kcal_100: 106, protein_100: 24, carbs_100: 0, fat_100: 1.2, fibre_100: 0 },
      { name: "Basmati rice", grams: 120, kcal_100: 349, protein_100: 8.1, carbs_100: 77, fat_100: 1.1, fibre_100: 1.4 },
      { name: "Broccoli", grams: 200, kcal_100: 34, protein_100: 2.8, carbs_100: 4, fat_100: 0.4, fibre_100: 2.6 },
    ],
  },
  {
    id: 3,
    name: "Pre-swim top-up",
    times_per_day: 1,
    // Only on days with a swim in them.
    day_type_ids: [byName("Swim only"), byName("Swim + gym"), byName("Double swim")],
    ingredients: [
      { name: "Bagel", grams: 85, kcal_100: 270, protein_100: 9, carbs_100: 51, fat_100: 1.5, fibre_100: 2.4 },
      { name: "Honey", grams: 20, kcal_100: 304, protein_100: 0.3, carbs_100: 82, fat_100: 0, fibre_100: 0 },
    ],
  },
];

const list = buildShoppingList(meals as any, profile, plan, { days: 7, startDay: "2026-08-29" });
console.log("mix:", list.dayMix.map((d) => `${d.count}× ${d.name}`).join(", "));
console.log("total", list.totalKg.toFixed(2), "kg");
for (const g of list.byAisle) {
  for (const l of g.lines) {
    const amt = l.unit ? `${l.unit.count} ${l.unit.name}s` : `${Math.round(l.buyGrams)} g`;
    console.log(`  ${l.name.padEnd(20)} need ${Math.round(l.needGrams).toString().padStart(5)} g  buy ${amt}`);
  }
}
const bagel = list.lines.find((l) => l.name === "Bagel");
console.log("\nbagels — 5 swim days x 85 g =", bagel?.needGrams.toFixed(0), "g (expect 425)");
console.log("warnings:");
for (const w of list.warnings) console.log("  -", w.title + (w.detail ? ` — ${w.detail}` : ""));
