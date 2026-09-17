/**
 * The steer shaping protein and fat, not only the calorie total.
 * Run with: npx tsx bench/macro-shape.ts
 *
 * The thing being checked is that this is a FUNCTION of the steer and not a
 * second controller: the same `recomp_adjust` always produces the same protein
 * and fat, nothing here reads the scale, and with the steer at zero the plan is
 * byte-for-byte what it was before any of this existed.
 */
import {
  FAT_PER_KG_CEILING,
  FAT_PER_KG_FLOOR,
  PROTEIN_PER_LEAN_CEILING,
  STEER_LIMIT,
  buildWeekPlan,
  shapeMacros,
  type Profile,
} from "../lib/nutrition";
import { normaliseProfile } from "../lib/profile";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const at = (steer: number, extra: Partial<Profile> = {}): Profile =>
  normaliseProfile({ ...REAL_PROFILE, recomp_adjust: steer, ...extra });

console.log("=== off by setting, or with nothing to shape ===\n");

{
  const p = at(-0.08, { adapt_macros: false });
  const s = shapeMacros(p);
  check("the switch off leaves both alone", !s.shaped && s.fatPerKg === p.fat_per_kg);
}
{
  const p = at(0);
  const s = shapeMacros(p);
  check("a steer of zero changes nothing", !s.shaped, `${s.proteinPerKg} / ${s.fatPerKg}`);

  const plain = buildWeekPlan(normaliseProfile({ ...REAL_PROFILE, adapt_macros: false }), REAL_DAY_TYPES);
  const shapedPlan = buildWeekPlan(p, REAL_DAY_TYPES);
  const same = REAL_DAY_TYPES.every((t) => {
    const a = plain.byId[t.id];
    const b = shapedPlan.byId[t.id];
    return a.kcal === b.kcal && a.protein === b.protein && a.fat === b.fat && a.carbs === b.carbs;
  });
  check("and the whole week is identical to the old behaviour", same);
}

console.log("\n=== cutting ===\n");

{
  const base = at(0);
  const p = at(-STEER_LIMIT);
  const s = shapeMacros(p);
  check("fat comes down with the calories", s.fatPerKg < base.fat_per_kg, `${s.fatPerKg} g/kg`);
  check("protein goes UP, never down", s.proteinPerKg > base.protein_per_kg, `${s.proteinPerKg} g/kg lean`);
  check("fat stays above its floor", s.fatPerKg >= FAT_PER_KG_FLOOR);
  check("protein stays under its ceiling", s.proteinPerKg <= PROTEIN_PER_LEAN_CEILING);

  /*
   * The point of the whole exercise: the cut is shared instead of landing
   * entirely on carbohydrate.
   */
  const before = buildWeekPlan(at(0), REAL_DAY_TYPES);
  const after = buildWeekPlan(p, REAL_DAY_TYPES);
  const id = REAL_DAY_TYPES[0].id;
  const dFat = after.byId[id].fat - before.byId[id].fat;
  const dCarb = after.byId[id].carbs - before.byId[id].carbs;
  console.log(`        ${before.byId[id].name}: fat ${dFat} g, carbs ${dCarb} g`);
  check("fat takes some of the cut", dFat < 0);
  check("carbohydrate still takes most of it", Math.abs(dCarb * 4) > Math.abs(dFat * 9));
}

console.log("\n=== eating more ===\n");

{
  const base = at(0);
  const p = at(STEER_LIMIT);
  const s = shapeMacros(p);
  check("fat goes up with the calories", s.fatPerKg > base.fat_per_kg, `${s.fatPerKg} g/kg`);
  check("protein is not reduced by a surplus", s.proteinPerKg === base.protein_per_kg);
  check("fat stays under its ceiling", s.fatPerKg <= FAT_PER_KG_CEILING);
}

console.log("\n=== the clamps hold at absurd settings ===\n");

{
  const p = at(-STEER_LIMIT, { fat_per_kg: 0.62 });
  check("a low fat setting cannot be pushed under the floor", shapeMacros(p).fatPerKg >= FAT_PER_KG_FLOOR);
}
{
  const p = at(STEER_LIMIT, { fat_per_kg: 1.28 });
  check("a high one cannot be pushed over the ceiling", shapeMacros(p).fatPerKg <= FAT_PER_KG_CEILING);
}
{
  const p = at(-STEER_LIMIT, { protein_per_kg: 2.95 });
  check(
    "protein cannot be pushed over its ceiling",
    shapeMacros(p).proteinPerKg <= PROTEIN_PER_LEAN_CEILING,
  );
}
{
  const p = at(-STEER_LIMIT, { protein_basis: "bodyweight" });
  check(
    "the protein bonus is for a lean-mass basis only",
    shapeMacros(p).proteinPerKg === p.protein_per_kg,
  );
}

console.log("\n=== it is a function of the steer, not a second opinion ===\n");

{
  const once = shapeMacros(at(-0.05));
  const twice = shapeMacros(at(-0.05));
  check("same steer, same answer", once.fatPerKg === twice.fatPerKg && once.proteinPerKg === twice.proteinPerKg);

  const steps = [-0.12, -0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09, 0.12].map((v) => shapeMacros(at(v)).fatPerKg);
  const monotonic = steps.every((v, i) => i === 0 || v >= steps[i - 1]);
  check("and it moves one way only as the steer rises", monotonic, steps.join(" → "));
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} case${failures === 1 ? "" : "s"}`);
process.exit(failures === 0 ? 0 : 1);
