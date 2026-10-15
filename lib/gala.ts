/**
 * Gala days: a race day eaten at a quarter more carbohydrate.
 *
 * Two jobs. The first is the food — every meal with its carbohydrate up by
 * `GALA_CARB_UPLIFT`, so on a race day you can pick whichever meals you
 * actually eat and each one is already the bigger version. The second is the
 * scale — a gala day stores glycogen, glycogen is stored with water, and the
 * next few mornings read heavier for reasons that have nothing to do with fat.
 * Those readings still count (the days are real, and any meal out on them is
 * real), but with the water taken off and less weight in the fit.
 *
 * ---------------------------------------------------------------------------
 * PER MEAL, NOT PER DAY
 * ---------------------------------------------------------------------------
 * A race day doesn't follow the plan's list of meals: you eat what fits round
 * the heats. So the uplift is applied to each meal on its own, and any meal
 * you log is a quarter up in carbohydrate whatever else you do or skip. A
 * whole-day uplift spread across "the best meals" would only be right if you
 * ate exactly those.
 *
 * Inside a meal, the carbohydrate foods rise together by one factor — rice and
 * sweetcorn up in step, granola and honey up in step — so the meal keeps its
 * shape rather than one ingredient doubling. Protein and fat rise only by what
 * those foods carry with them (granola brings fat; that is fine).
 *
 * Limits still mean something. Pure sugars — honey, syrup, jam — never pass
 * their usual top: past that a meal turns sickly, and Ethan has said as much
 * about honey. Everything else may go a quarter past its usual top, because a
 * gala portion is a quarter bigger by definition. Fixed portions (exactly
 * 250 g of milk, one banana, whole units) do not move at all.
 */
import { boundsFor, type BoundedItem } from "./optimise";
import { sumMacros, totalFor, type Item, type Targets, type WeekPlan } from "./nutrition";
import type { WeighIn } from "./trend";

/** A quarter more carbohydrate. */
export const GALA_CARB_UPLIFT = 0.25;

/** How far past its usual top limit a non-sugar portion may go on a gala day. */
export const GALA_STRETCH = 1.25;

const num = (v: unknown) => Number(v) || 0;

/** Honey, syrup, jam: nearly all sugar, nothing else. These never stretch. */
export function isSugar(it: Item): boolean {
  return num(it.carbs_100) >= 60 && num(it.protein_100) < 1 && num(it.fat_100) < 1;
}

/** A food that is there for its carbohydrate: pasta, rice, granola, dates. */
function isCarbFood(it: Item): boolean {
  const c = num(it.carbs_100);
  const k = num(it.kcal_100);
  return c >= 15 && k > 0 && (c * 4) / k >= 0.4;
}

/**
 * The fallback tier, for a meal whose carbohydrate isn't in a starch: yoghurt,
 * sweetcorn. Never a protein food — a protein shake scaled up to find two
 * grams of carbohydrate is not a better shake.
 */
function isMixedCarb(it: Item): boolean {
  const c = num(it.carbs_100);
  const p = num(it.protein_100);
  const k = num(it.kcal_100);
  return c >= 5 && k > 0 && (c * 4) / k >= 0.25 && (p * 4) / k < 0.5;
}

export type GalaMeal<T> = {
  items: T[];
  /** The carbohydrate rise actually reached, as a fraction: 0.25 is on target. */
  uplift: number;
};

/**
 * One meal, a quarter up in carbohydrate.
 *
 * Fills from the starches first, by one shared factor, capping each at its
 * gala limit and handing what it couldn't take to the rest; only if the
 * starches run out of room does it reach for mixed foods. Portions are then
 * rounded to the step you'd weigh them in, never below the usual amount.
 */
export function galaMeal<T extends BoundedItem>(items: T[], uplift = GALA_CARB_UPLIFT): GalaMeal<T> {
  const grams = items.map((i) => Math.max(0, num(i.grams)));
  const perG = items.map((i) => num(i.carbs_100) / 100);
  const c0 = grams.reduce((a, g, i) => a + g * perG[i], 0);
  if (!(c0 > 0) || !(uplift > 0)) return { items, uplift: 0 };

  const bounds = items.map((it) => boundsFor(it));
  const caps = items.map((it, i) => {
    const b = bounds[i];
    if (it.locked || b.max <= b.min) return grams[i];
    const top = Math.max(b.max, grams[i]);
    return isSugar(it) ? top : top * GALA_STRETCH;
  });

  const next = [...grams];
  let need = uplift * c0;
  const tiers = [(i: number) => isCarbFood(items[i]), (i: number) => isMixedCarb(items[i])];
  for (const inTier of tiers) {
    let free = items
      .map((_, i) => i)
      .filter((i) => inTier(i) && grams[i] > 0 && caps[i] > next[i] + 1e-9);
    while (need > 0.5 && free.length) {
      const base = free.reduce((a, i) => a + next[i] * perG[i], 0);
      if (!(base > 0)) break;
      const f = 1 + need / base;
      const over = free.filter((i) => next[i] * f > caps[i]);
      if (!over.length) {
        for (const i of free) next[i] *= f;
        need = 0;
        break;
      }
      for (const i of over) {
        need -= (caps[i] - next[i]) * perG[i];
        next[i] = caps[i];
      }
      free = free.filter((i) => !over.includes(i));
    }
    if (need <= 0.5) break;
  }

  // Whole units (rice cakes, wraps) move a whole unit at a time, and only
  // within the cap — half a rice cake is not a portion.
  const out = items.map((it, i) => {
    if (Math.abs(next[i] - grams[i]) < 1e-9) return it;
    const step = bounds[i].step || 1;
    let g = Math.round(next[i] / step) * step;
    if (g > caps[i] + 1e-9) g = Math.floor(caps[i] / step) * step;
    g = Math.max(grams[i], g);
    return g === grams[i] ? it : { ...it, grams: g };
  });
  const c1 = totalFor(out).carbs;
  return { items: out, uplift: (c1 - c0) / c0 };
}

/** A day's targets on a gala day: carbohydrate a quarter up, the calories with it. */
export function galaTargets<T extends Targets>(t: T, uplift = GALA_CARB_UPLIFT): T {
  const extra = t.carbs * uplift;
  return { ...t, carbs: t.carbs + extra, kcal: t.kcal + extra * 4 };
}

/** Every kind of day as a gala day. */
export function galaPlan(plan: WeekPlan, uplift = GALA_CARB_UPLIFT): WeekPlan {
  const byId: WeekPlan["byId"] = {};
  for (const [id, t] of Object.entries(plan.byId)) byId[Number(id)] = galaTargets(t, uplift);
  return { ...plan, byId };
}

/** Several meals' totals, gala or not — the same sum the Today page shows. */
export function mealsTotal(meals: { ingredients: Item[] }[]) {
  return sumMacros(meals.map((m) => totalFor(m.ingredients)));
}

/* ------------------------------------------------------------------ */
/* What a gala day does to the scale                                   */
/* ------------------------------------------------------------------ */

/**
 * A gala day, and how much carbohydrate it carried over a normal one.
 *
 * `extraCarbs` comes from what was logged — meals and cheat meals both — less
 * that day's usual target. See `galaExtraCarbs`.
 */
export type GalaDay = { day: string; extraCarbs: number };

/**
 * Kilos on the morning scale per gram of carbohydrate over a normal day.
 *
 * Glycogen is stored with at least three grams of water per gram (Fernández-
 * Elías et al., Eur J Appl Physiol 2015; Olsson & Saltin 1970 put it at 3–4).
 * Not every extra gram is stored, though: a hard 72-hour load at 12 g/kg/day
 * — roughly 1.4 kg more carbohydrate than usual — raised total body water by
 * only 0.9 kg (Shiose et al., J Appl Physiol 2016), call it 1.1–1.2 kg with
 * the glycogen itself. That is about 0.8 g on the scale per extra gram, which
 * is what is used here. It is deliberately not larger: a 2026 dose-response
 * trial found no clear body-mass difference between 6, 8 and 10 g/kg/day
 * (Jones et al., Scand J Med Sci Sports), so a quarter more for a weekend
 * moves the scale by a few hundred grams, not kilos.
 */
export const GLYCOGEN_KG_PER_EXTRA_G = 0.0008;

/**
 * The share still held each further day. Training burns stored glycogen back
 * down over two or three days of normal eating; 0.6 a day leaves about a fifth
 * after three days and almost nothing after five.
 */
export const GLYCOGEN_HOLD_PER_DAY = 0.6;

/** The most the correction will take off any one morning. */
export const GALA_OFFSET_MAX_KG = 1.5;

/**
 * How much a reading in a gala's wake counts toward the rate, against 1 for an
 * ordinary morning. Salt and gut contents from a big race-day plate come on top
 * of the glycogen and are not worth modelling — the reading is simply trusted
 * less until they've cleared.
 */
export const GALA_TRUST = 0.5;

/** Days after a gala day that a reading is still trusted less. */
export const GALA_WAKE_DAYS = 3;

/**
 * The extra carbohydrate a gala day carried.
 *
 * What was logged less the day's usual target. A day that was barely logged is
 * taken as eaten to the gala plan — a quarter up — rather than as a normal day,
 * because "I didn't tick the meals" is far more likely than "I ate less on race
 * day". Capped at one and a half normal days so a typo can't make a kilo vanish.
 */
export function galaExtraCarbs(loggedCarbs: number, baseCarbs: number): number {
  const logged = Math.max(0, num(loggedCarbs));
  if (!(baseCarbs > 0)) return logged;
  const planned = baseCarbs * GALA_CARB_UPLIFT;
  return Math.min(baseCarbs * 1.5, Math.max(planned, logged - baseCarbs));
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86_400_000
  );
}

/** Glycogen water on the scale the morning of `day`, from gala days before it. */
export function galaOffsetOn(day: string, gala: GalaDay[]): number {
  let kg = 0;
  for (const g of gala) {
    const gap = daysBetween(g.day, day);
    if (gap < 1) continue;
    kg += Math.max(0, g.extraCarbs) * GLYCOGEN_KG_PER_EXTRA_G * GLYCOGEN_HOLD_PER_DAY ** (gap - 1);
  }
  return Math.min(GALA_OFFSET_MAX_KG, kg);
}

/** True from a gala day itself until `GALA_WAKE_DAYS` mornings after it. */
export function inGalaWake(day: string, gala: GalaDay[]): boolean {
  return gala.some((g) => {
    const gap = daysBetween(g.day, day);
    return gap >= 0 && gap <= GALA_WAKE_DAYS;
  });
}

const SEGMENT_MUSCLE = [
  "seg_la_muscle_kg",
  "seg_ra_muscle_kg",
  "seg_tr_muscle_kg",
  "seg_ll_muscle_kg",
  "seg_rl_muscle_kg",
] as const;

/**
 * Weigh-ins and scans with a gala's glycogen water taken off.
 *
 * - **Weight**: the offset comes straight off.
 * - **Body fat**: bioimpedance counts the water as lean, so its fat *mass*
 *   barely moves while the scale weight rises — the percentage reads low by
 *   weight ÷ (weight − water). That ratio is put back.
 * - **Muscle**: the same water is read as muscle, so it comes off the muscle
 *   figure, and off each limb in proportion.
 * - **Trust**: anything in a gala's wake counts `GALA_TRUST` in the rate.
 *
 * Nothing is dropped. The readings happened and the meals on those days were
 * real; they are read for what they say about tissue, not about water.
 */
export function applyGalaSkew(entries: WeighIn[], gala: GalaDay[]): WeighIn[] {
  if (!gala.length) return entries;
  return entries.map((e) => {
    const off = galaOffsetOn(e.day, gala);
    const wake = inGalaWake(e.day, gala);
    if (off < 0.005 && !wake) return e;

    const out: WeighIn = { ...e };
    if (wake) out.trust = Math.min(e.trust ?? 1, GALA_TRUST);
    if (off < 0.005) return out;

    const w = e.weight_kg == null ? null : Number(e.weight_kg);
    if (w != null && w > off + 20) {
      out.weight_kg = w - off;
      if (e.bf_pct != null && Number(e.bf_pct) > 0) {
        out.bf_pct = Math.min(60, (Number(e.bf_pct) * w) / (w - off));
      }
    }
    const muscle = e.muscle_kg == null ? null : Number(e.muscle_kg);
    if (muscle != null && muscle > off) {
      out.muscle_kg = muscle - off;
      const segs = SEGMENT_MUSCLE.map((k) => (e as any)[k]).map((v) => (v == null ? null : Number(v)));
      if (segs.every((v) => v != null && v > 0)) {
        const sum = (segs as number[]).reduce((a, v) => a + v, 0);
        SEGMENT_MUSCLE.forEach((k, i) => {
          (out as any)[k] = (segs[i] as number) * (1 - off / sum);
        });
      }
    }
    return out;
  });
}
