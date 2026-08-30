/** What leaning protein and fat toward the training does to the targets. */
import { buildWeekPlan, targetsFor, trainingLoad } from "../lib/nutrition";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

for (const on of [false, true]) {
  const plan = buildWeekPlan({ ...REAL_PROFILE, periodise: on }, REAL_DAY_TYPES, { today: "2026-08-31" });
  console.log(`\n--- periodised: ${on} ---`);
  console.log("day type        load   kcal  protein  carbs   fat   fat% of kcal");
  let n=0,p=0,f=0,c=0;
  for (const id of [1,3,4]) {
    const t = targetsFor(plan, id);
    const dt = REAL_DAY_TYPES.find(d=>d.id===id)!;
    const days = id===1?1:3;
    n+=days; p+=t.protein*days; f+=t.fat*days; c+=t.carbs*days;
    console.log(`${t.name.padEnd(14)}${String(Math.round(trainingLoad(dt))).padStart(4)}m ${String(t.kcal).padStart(6)}  ${String(t.protein).padStart(5)}  ${String(t.carbs).padStart(5)}  ${String(t.fat).padStart(4)}   ${((t.fat*9/t.kcal)*100).toFixed(0)}%`);
  }
  console.log(`week average           protein ${(p/n).toFixed(1)}  carbs ${(c/n).toFixed(0)}  fat ${(f/n).toFixed(1)}`);
}
