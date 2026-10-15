/**
 * Gala days: the bigger meals, and what they do to the scale.
 *
 * What has to be true:
 *
 *  1. Every meal lands close to a quarter more carbohydrate where its limits
 *     allow, never more, and never by shrinking anything.
 *  2. It stays a meal you'd eat: honey never passes its usual top, fixed
 *     portions don't move, protein foods aren't scaled to chase carbs, and the
 *     starches in a meal rise together.
 *  3. A gala weekend's glycogen water doesn't read as gain: with the gala days
 *     known, the rate through one is close to the true rate.
 *  4. Meals out on gala days are unlimited, but only the week's first is free.
 *
 * Run: npx tsx bench/gala.ts
 */

import { WEEKDAYS, buildWeekPlan, totalFor } from "../lib/nutrition";
import {
  GALA_CARB_UPLIFT,
  applyGalaSkew,
  galaExtraCarbs,
  galaMeal,
  galaOffsetOn,
  galaPlan,
  galaTargets,
  isSugar,
  type GalaDay,
} from "../lib/gala";
import { cheatDebt, type CheatMeal } from "../lib/cheat";
import { steerSignals } from "../lib/steer";
import type { WeighIn } from "../lib/trend";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

/* --- 1 & 2. the meals ---------------------------------------------------- */

// The plan as it is in the app today, limits and all (15 Oct 2026).
const ing = (
  name: string,
  grams: number,
  kcal_100: number,
  protein_100: number,
  carbs_100: number,
  fat_100: number,
  min_grams: number | null,
  max_grams: number | null
) => ({ name, grams, kcal_100, protein_100, carbs_100, fat_100, min_grams, max_grams, locked: false });

const LIVE = [
  {
    name: "Breakfast",
    ingredients: [
      ing("Rice Cakes", 63, 394, 8.5, 82.3, 2.8, 49, 77),
      ing("Banana", 105, 89, 1.1, 22.8, 0.3, 105, 105),
      ing("Honey", 50, 325, 0, 81.2, 0, 21, 50),
      ing("Milk", 250, 50, 3.6, 4.8, 1.8, 250, 250),
      ing("Protein Powder", 26, 394, 72, 11.5, 6.1, 24, 26),
    ],
  },
  {
    name: "Lunch",
    ingredients: [
      ing("Pasta", 160, 157, 5.8, 32, 0.5, 160, 240),
      ing("Tuna", 112, 109, 24.9, 0, 1, 112, 224),
      ing("Mayonnaise", 48, 696, 1.1, 1.7, 76, 25, 50),
      ing("Sweetcorn", 70, 77, 2.6, 11.5, 1.7, 60, 100),
    ],
  },
  { name: "Pre Swim", ingredients: [ing("Dates", 74, 265, 2.4, 58.7, 0.6, 45, 80)] },
  {
    name: "Post Swim",
    ingredients: [
      ing("Greek Yohurt", 390, 60, 6.1, 7.7, 0.4, 390, 450),
      ing("Protein Grenola", 81, 461, 17.9, 55, 17.3, 75, 115),
      ing("Honey", 20, 325, 0, 81.2, 0, 10, 26),
    ],
  },
  {
    name: "Post Gym",
    ingredients: [
      ing("Bagel", 43, 263, 9.2, 50.9, 1.8, 43, 43),
      ing("Peanut Butter", 16, 652, 25.4, 17.3, 52.1, 15, 28),
    ],
  },
  {
    name: "Dinner",
    ingredients: [
      ing("Chicken Breast", 190, 106, 24, 0, 1.1, 190, 250),
      ing("White Rice", 142, 369, 8.1, 83.7, 0.5, 90, 170),
      ing("Sweetcorn", 70, 77, 2.6, 11.5, 1.7, 60, 100),
    ],
  },
];

const PROTEIN_FOODS = new Set(["Tuna", "Chicken Breast", "Protein Powder", "Milk", "Greek Yohurt"]);

for (const [label, meals] of [
  ["the plan in the app", LIVE],
  ["the bench plan", REAL_MEALS],
] as const) {
  console.log(`\n${label}`);
  for (const m of meals) {
    const g = galaMeal(m.ingredients as any[]);
    const before = totalFor(m.ingredients as any[]);
    const after = totalFor(g.items);
    const moved = g.items
      .map((it, i) => ({ it, was: Number(m.ingredients[i].grams) }))
      .filter((x) => x.it.grams !== x.was);
    console.log(
      `  ${m.name.padEnd(10)} carbs ${Math.round(before.carbs)} → ${Math.round(after.carbs)} g ` +
        `(+${Math.round(g.uplift * 100)}%), kcal ${Math.round(before.kcal)} → ${Math.round(after.kcal)}` +
        (moved.length ? `  [${moved.map((x) => `${x.it.name} ${x.was}→${x.it.grams}`).join(", ")}]` : "")
    );
    check(`${m.name}: never over a quarter`, g.uplift <= GALA_CARB_UPLIFT + 0.03, `+${(g.uplift * 100).toFixed(1)}%`);
    check(
      `${m.name}: nothing shrinks`,
      g.items.every((it, i) => it.grams >= Number(m.ingredients[i].grams))
    );
    for (const [i, it] of g.items.entries()) {
      const src = m.ingredients[i] as any;
      if (src.min_grams != null && src.min_grams === src.max_grams && it.grams !== src.grams) {
        check(`${m.name}: ${it.name} is fixed and stays put`, false, `${src.grams} → ${it.grams}`);
      }
      if (isSugar(it) && src.max_grams != null && it.grams > Math.max(src.max_grams, src.grams)) {
        check(`${m.name}: ${it.name} stays under its usual top`, false, `${it.grams} > ${src.max_grams}`);
      }
      if (PROTEIN_FOODS.has(it.name) && it.grams !== src.grams) {
        check(`${m.name}: ${it.name} isn't scaled to chase carbs`, false, `${src.grams} → ${it.grams}`);
      }
    }
  }
}

const post = galaMeal(LIVE[3].ingredients);
const honey = post.items.find((i) => i.name === "Honey")!;
const granola = post.items.find((i) => i.name === "Protein Grenola")!;
check("Post Swim: honey stays at or under 26 g", honey.grams <= 26, `${honey.grams} g`);
check("Post Swim: the granola takes most of the rise", granola.grams - 81 > (honey.grams - 20) * 2, `${granola.grams} g`);
check("Post Swim reaches the full quarter", post.uplift >= 0.22, `+${Math.round(post.uplift * 100)}%`);

const lunch = galaMeal(LIVE[1].ingredients);
check("Lunch reaches the full quarter on pasta", lunch.uplift >= 0.22, `+${Math.round(lunch.uplift * 100)}%`);

/* --- targets ------------------------------------------------------------- */

console.log("\ntargets");
const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES);
const gp = galaPlan(plan);
for (const id of new Set(WEEKDAYS.map((d) => plan.week[d]))) {
  const a = plan.byId[id];
  const b = gp.byId[id];
  check(
    `${a.name}: carbs a quarter up, calories with them`,
    Math.abs(b.carbs - a.carbs * 1.25) < 0.01 && Math.abs(b.kcal - (a.kcal + a.carbs * 0.25 * 4)) < 0.01,
    `${Math.round(a.carbs)} → ${Math.round(b.carbs)} g, ${Math.round(a.kcal)} → ${Math.round(b.kcal)} kcal`
  );
}
const t = galaTargets(plan.byId[plan.order[0]]);
check("protein and fat targets don't move", t.protein === plan.byId[plan.order[0]].protein && t.fat === plan.byId[plan.order[0]].fat);

/* --- 3. the scale -------------------------------------------------------- */

console.log("\nthe scale");
check("an unlogged gala day counts as eaten to the plan", galaExtraCarbs(0, 460) === 115);
check("a logged one counts what was eaten", galaExtraCarbs(700, 460) === 240);
check("a typo can't run away", galaExtraCarbs(5000, 460) === 690);

const weekend: GalaDay[] = [
  { day: "2026-10-16", extraCarbs: 115 },
  { day: "2026-10-17", extraCarbs: 115 },
  { day: "2026-10-18", extraCarbs: 115 },
];
const peak = galaOffsetOn("2026-10-19", weekend);
const later = galaOffsetOn("2026-10-23", weekend);
console.log(`  glycogen water: ${peak.toFixed(2)} kg the Monday after, ${later.toFixed(2)} kg by Friday`);
check("a quarter-up weekend is a few hundred grams, not kilos", peak > 0.1 && peak < 0.4);
check("and it has mostly gone within the week", later < peak * 0.2);
check("nothing before the first gala day", galaOffsetOn("2026-10-16", weekend) === 0);

const scan: WeighIn = { day: "2026-10-19", weight_kg: 77.5, bf_pct: 12.8, bf_method: "scan", muscle_kg: 62.4 };
const [fixed] = applyGalaSkew([scan], weekend);
check("weight comes down by the water", Math.abs(Number(fixed.weight_kg) - (77.5 - peak)) < 1e-9);
check("body fat goes back up (the scan read the water as lean)", Number(fixed.bf_pct) > 12.8, `${Number(fixed.bf_pct).toFixed(2)}%`);
check("muscle comes down by the water", Math.abs(Number(fixed.muscle_kg) - (62.4 - peak)) < 1e-9);
check("and the reading is trusted less", fixed.trust === 0.5);

/*
 * A flat month with a gala weekend in it. The body doesn't change; the scale
 * carries the glycogen water plus half a kilo of salt and food the morning
 * after each big day. Known gala days should read close to flat.
 */
function rngFrom(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.4;
}
let worse = 0;
const runs = 30;
let sumWith = 0;
let sumWithout = 0;
for (let k = 0; k < runs; k++) {
  const noise = rngFrom(100 + k * 31);
  const entries: WeighIn[] = [];
  for (let d = 0; d < 35; d++) {
    const day = new Date(Date.UTC(2026, 8, 21 + d)).toISOString().slice(0, 10);
    const water = galaOffsetOn(day, weekend);
    const gut = weekend.some((g) => {
      const gap = (Date.parse(day) - Date.parse(g.day)) / 86_400_000;
      return gap === 1;
    })
      ? 0.5
      : 0;
    entries.push({ day, weight_kg: 77 + water + gut + noise(), at_time: "07:30" });
  }
  const without = steerSignals(entries).rate!;
  const withGala = steerSignals(entries, [], weekend).rate!;
  sumWith += Math.abs(withGala.kgPerWeek);
  sumWithout += Math.abs(without.kgPerWeek);
  if (Math.abs(withGala.kgPerWeek) > Math.abs(without.kgPerWeek) + 0.02) worse++;
}
console.log(
  `  flat month with a gala weekend: |rate| ${(sumWithout / runs).toFixed(3)} kg/wk unread, ` +
    `${(sumWith / runs).toFixed(3)} kg/wk with the gala days known`
);
check("knowing the gala days reads closer to the truth", sumWith < sumWithout);
check("and almost never worse", worse <= 2, `${worse} of ${runs}`);

/* --- 4. meals out -------------------------------------------------------- */

console.log("\nmeals out on gala days");
const meal = (id: number, day: string, kcal: number): CheatMeal => ({
  id,
  day,
  meal_id: null,
  name: `Meal ${id}`,
  kcal,
  protein: 0,
  carbs: 0,
  fat: 0,
});
const galaSet = new Set(["2026-10-17", "2026-10-18"]);
const sizes = new Map<number, number>();
const onlyGala = cheatDebt(
  [meal(1, "2026-10-17", 900), meal(2, "2026-10-17", 600), meal(3, "2026-10-18", 1200)],
  sizes,
  "2026-10-12",
  "2026-10-18",
  galaSet
);
check("a week whose only meals out were at a gala: the first is free", onlyGala.kcal === 1800, `${onlyGala.kcal} kcal owed`);

const plusNormal = cheatDebt(
  [meal(4, "2026-10-13", 1000), meal(1, "2026-10-17", 900), meal(2, "2026-10-17", 600)],
  sizes,
  "2026-10-12",
  "2026-10-18",
  galaSet
);
check(
  "with an ordinary one in the week, every gala one is owed",
  plusNormal.kcal === 1500 && plusNormal.extras.every((c) => galaSet.has(c.day)),
  `${plusNormal.kcal} kcal owed`
);

const noGala = cheatDebt([meal(5, "2026-10-13", 1000), meal(6, "2026-10-15", 700)], sizes, "2026-10-12", "2026-10-18");
check("without gala days nothing changes: the earliest is free", noGala.kcal === 700);

console.log(failed ? `\n${failed} failed` : "\nall good");
process.exitCode = failed ? 1 : 0;
