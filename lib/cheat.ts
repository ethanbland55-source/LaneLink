/**
 * Cheat meals, and what a maintenance phase actually does with one.
 *
 * On a deficit a cheat meal is close to free. You are running 500 kcal under
 * every day, so a 1200 kcal restaurant meal spends two days of deficit and the
 * week still ends where it was going to end. That is why the received wisdom
 * about cheat meals is as relaxed as it is — it was written for people who are
 * cutting.
 *
 * Toned maintenance has no deficit to spend. Sitting at or a shade under
 * maintenance while getting steadily leaner is a slow business that works
 * because the weekly average holds and protein stays high; a meal out that
 * lands 900 kcal over the day is 900 kcal that has nowhere to go, and at
 * maintenance "nowhere to go" means stored. One a week, unabsorbed, is roughly
 * 47,000 kcal a year — about six kilos. The whole point of the phase is that
 * that doesn't happen quietly.
 *
 * So the deal this module implements is: have the meal, and let the week pay
 * for it honestly.
 *
 *   1. **The meal it replaces comes off the day.** That is usually the biggest
 *      single saving and it costs nothing, because you weren't going to eat
 *      dinner and a curry.
 *   2. **What's left of the day is re-fitted.** Only the parts that can move —
 *      food that isn't already cooked and portioned into a container. A box of
 *      pasta and tuna you filled on Sunday is a fixed quantity by Friday, and
 *      an absorber that "reduces" it to 82% is describing a meal you will not
 *      eat. See `isPrepped` in lib/batch.ts.
 *   3. **If that isn't enough, meals come off**, cheapest first, and never the
 *      ones doing a job: protein is what protects lean mass at maintenance,
 *      and a meal timed around a session is fuelling rather than calories. A
 *      cooked-ahead meal can be dropped even though it can't be shrunk — you
 *      leave the box in the fridge and eat it another day.
 *   4. **Whatever the day still cannot hold is spread over the rest of the
 *      week**, in small daily amounts with a floor under them — but sparingly.
 *      A meal out should be paid for mostly on the day it happens, not turned
 *      into four days of eating slightly less than you planned to.
 *   5. **Anything left after that is reported, in grams of fat**, because a
 *      number you can see is worth more than a plan that quietly pretends.
 *
 * Nothing here is written back to the plan. A cheat meal is one day's
 * instruction — the portions in the fridge do not change because you went out
 * on Friday, and next week's plan should not inherit Friday either.
 */

import {
  itemMacros,
  sumMacros,
  targetsFor,
  WEEKDAYS,
  ZERO_MACROS,
  type DayType,
  type Macros,
  type WeekPlan,
} from "./nutrition";
import { appliesOn, buildWeekFit, repsOf } from "./weekfit";
import { solveRows } from "./optimise";
import { expand, hasPrepped, isPrepped, type PlanMeal } from "./batch";
import { fixedMacros, type Supplement } from "./supplements";

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export type CheatMeal = {
  id?: number;
  /** The calendar day it is eaten. */
  day: string;
  /** The meal it stands in for. Null means it is an extra, not a swap. */
  meal_id: number | null;
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  note?: string | null;
};

export function cheatMacros(c: CheatMeal): Macros {
  return {
    kcal: Number(c.kcal) || 0,
    protein: Number(c.protein) || 0,
    carbs: Number(c.carbs) || 0,
    fat: Number(c.fat) || 0,
  };
}

/**
 * Calories from the macros, when you only half-know them.
 *
 * A menu tells you the calories and nothing else; a photo of a label tells you
 * everything. Either is a fine thing to type in, so whichever is missing is
 * inferred from the other rather than being demanded. 4/4/9 is close enough
 * for a meal you are estimating anyway.
 */
export function completeCheat(c: Partial<CheatMeal>): Macros {
  const p = Number(c.protein) || 0;
  const cb = Number(c.carbs) || 0;
  const f = Number(c.fat) || 0;
  const fromMacros = p * 4 + cb * 4 + f * 9;
  const kcal = Number(c.kcal) || 0;

  if (kcal > 0 && fromMacros <= 0) {
    // Calories only: assume a meal out — a third of it fat, a fifth protein.
    // Deliberately pessimistic on fat, because restaurant food usually is.
    return {
      kcal,
      protein: Math.round((kcal * 0.2) / 4),
      carbs: Math.round((kcal * 0.45) / 4),
      fat: Math.round((kcal * 0.35) / 9),
    };
  }
  return { kcal: kcal > 0 ? kcal : Math.round(fromMacros), protein: p, carbs: cb, fat: f };
}

/* ------------------------------------------------------------------ */
/* Absorbing it                                                        */
/* ------------------------------------------------------------------ */

export type MealOutcome = {
  mealId: number;
  name: string;
  action: "kept" | "replaced" | "resized" | "dropped";
  before: Macros;
  after: Macros;
  /** Portion changes, for the ones that moved. */
  portions: { name: string; from: number; to: number }[];
  why?: string;
};

export type SpreadDay = {
  day: string;
  weekday: string;
  dayTypeId: number;
  /** Calories to come off that day. Always a positive number. */
  kcal: number;
};

export type Absorption = {
  day: string;
  dayTypeId: number;
  target: Macros;
  cheat: Macros;
  /** What the day now adds up to, cheat meal included. */
  after: Macros;
  meals: MealOutcome[];
  /** Calories the day itself could not absorb. */
  spill: number;
  /** How the spill is shared out over the days that follow. */
  spread: SpreadDay[];
  /** Calories still unaccounted for after the week has taken its share. */
  leftover: number;
  /** The honest translation of `leftover`, in grams of body fat. */
  leftoverFatGrams: number;
  notes: string[];
};

/** A day may not be cut below this share of its calorie target. */
const DAY_FLOOR = 0.78;
/**
 * Nor may any later day give up more than this share of its own.
 *
 * 6 % of a swim day is about 190 kcal — a smaller breakfast, or the peanut
 * butter off the bagel. It is the most you can take off a training day before
 * you are training on less than the day was built for, and the point of doing
 * this at all is that the swimming does not pay for the curry.
 *
 * It used to be 12 %, which absorbed almost anything without dropping a thing
 * and made a meal out feel free. It isn't free. Halving it means the day the
 * meal happens does most of the work, which is both the honest accounting and
 * much easier to live with: one heavier evening and a lighter day around it,
 * rather than a week that never quite hits its numbers.
 */
const SPREAD_CAP = 0.06;
/**
 * How much of the week's spare capacity to bank on before dropping a meal.
 *
 * Not all of it, deliberately. Counting on every remaining day giving up its
 * full share means one meal out uses the entire week's slack, and the next
 * thing that happens — a session moved, a second social — has nowhere to go.
 * Counting on none of it is the old behaviour, which deleted your lunch to
 * solve a problem four other days could have absorbed between them. Half
 * leaves the week a margin and still stops the dropping loop from being
 * trigger-happy.
 */
const SPREAD_SHARE = 0.5;
/**
 * Protein below this share of the day's target is not an outcome the absorber
 * is allowed to choose. It can still happen — swap out the chicken and there
 * is only so much a solver can do — but it will never be *preferred*, and it
 * is always said out loud.
 */
const PROTEIN_FLOOR = 0.9;
/** Calories in a gram of body fat, near enough. */
const KCAL_PER_G_FAT = 7.7;

/** Protein per calorie — what marks a meal as doing a job rather than filling. */
function proteinDensity(m: Macros): number {
  return m.kcal > 0 ? (m.protein * 4) / m.kcal : 0;
}

function macrosOf(meal: PlanMeal): Macros {
  const one = sumMacros(meal.ingredients.map(itemMacros));
  const n = repsOf(meal);
  return { kcal: one.kcal * n, protein: one.protein * n, carbs: one.carbs * n, fat: one.fat * n };
}

/**
 * A meal that exists because of a session, rather than in spite of one.
 *
 * Meals limited to day types that all carry a session are there to fuel or
 * recover from it. Dropping one to pay for a curry is a bad trade twice over:
 * you lose the training benefit and you keep the curry.
 */
function isFuelling(meal: PlanMeal, dayTypes: DayType[]): boolean {
  const ids = meal.day_type_ids;
  if (!ids || !ids.length) return false;
  const chosen = dayTypes.filter((d) => ids.includes(d.id));
  return chosen.length > 0 && chosen.every((d) => (d.sessions?.length ?? 0) > 0);
}

/**
 * Fit one day's movable food to what's left of its target.
 *
 * Uses the ordinary week solver with a week of one day. `protein_first`,
 * because the thing that must survive a cheat meal is the protein, and
 * `keep_close`, because a day that is 400 kcal lighter should look like the
 * day it replaces rather than a different meal plan.
 *
 * Anything cooked ahead is pinned before the solver sees it. Locking is
 * exactly the right mechanism — the portion is a number that is no longer up
 * for discussion — and it means the solve, the bounds and the reporting all
 * behave without a second code path. What moves instead is the food you plate
 * on the day: the shake, the fruit, the sweetcorn and the mayonnaise you were
 * going to add anyway.
 */
function fitOneDay(
  meals: PlanMeal[],
  plan: WeekPlan,
  dayTypeId: number,
  fixed: Macros,
  supplements: Supplement[]
): { meals: PlanMeal[]; totals: Macros } {
  const movable = meals
    .filter((m) => m.ingredients.length > 0)
    .map((m) =>
      hasPrepped(m)
        ? {
            ...m,
            ingredients: m.ingredients.map((it) =>
              isPrepped(m, it) ? { ...it, locked: true } : it
            ),
          }
        : m
    );
  if (!movable.length) return { meals, totals: { ...fixed } };

  const fit = buildWeekFit(movable, plan, supplements);
  const row = fit.rows.find((r) => r.id === dayTypeId);
  if (!row) return { meals, totals: { ...fixed } };

  const base = row.fixed ?? ZERO_MACROS;
  const one = {
    ...row,
    weight: 1,
    fixed: {
      kcal: base.kcal + fixed.kcal,
      protein: base.protein + fixed.protein,
      carbs: base.carbs + fixed.carbs,
      fat: base.fat + fixed.fat,
    },
  };

  const res = solveRows(fit.items, [one], {
    mode: "protein_first",
    shares: fit.shares,
    drift: "keep_close",
  });

  const fitted = expand(fit.meals, fit.slots, res.grams);
  const byId = new Map(fitted.map((m) => [m.id, m]));
  const out = meals.map((m) => byId.get(m.id) ?? m);

  const food = out.reduce<Macros>(
    (a, m) => {
      const mm = macrosOf(m);
      return {
        kcal: a.kcal + mm.kcal,
        protein: a.protein + mm.protein,
        carbs: a.carbs + mm.carbs,
        fat: a.fat + mm.fat,
      };
    },
    { ...ZERO_MACROS }
  );

  return {
    meals: out,
    totals: {
      kcal: food.kcal + one.fixed.kcal,
      protein: food.protein + one.fixed.protein,
      carbs: food.carbs + one.fixed.carbs,
      fat: food.fat + one.fixed.fat,
    },
  };
}

export type AbsorbInput = {
  cheat: CheatMeal;
  meals: PlanMeal[];
  plan: WeekPlan;
  dayTypes: DayType[];
  dayTypeId: number;
  supplements?: Supplement[];
  /** The days after this one that can share the spill, in order. */
  rest?: { day: string; dayTypeId: number }[];
};

/**
 * Work out what the day should look like with the cheat meal in it.
 *
 * The order matters and is the whole design: swap, then shrink, then drop,
 * then spread, then admit. Each step is cheaper to live with than the next
 * one, so the first one that works is the one you get.
 */
export function absorbCheat(input: AbsorbInput): Absorption {
  const { cheat, plan, dayTypes, dayTypeId, supplements = [], rest = [] } = input;
  const total = plan.order.length;
  const target = targetsFor(plan, dayTypeId);
  const macros = cheatMacros(cheat);
  const notes: string[] = [];

  const onMenu = input.meals.filter((m) => appliesOn(m, dayTypeId, total));
  const outcomes = new Map<number, MealOutcome>();
  for (const m of onMenu) {
    const before = macrosOf(m);
    outcomes.set(m.id, {
      mealId: m.id,
      name: m.name,
      action: "kept",
      before,
      after: before,
      portions: [],
    });
  }

  /* --- 1. the swap ----------------------------------------------------- */

  let remaining = onMenu;
  if (cheat.meal_id != null) {
    const swapped = onMenu.find((m) => m.id === cheat.meal_id);
    if (swapped) {
      const o = outcomes.get(swapped.id);
      if (o) {
        o.action = "replaced";
        o.after = { ...ZERO_MACROS };
        o.why = `${cheat.name} instead`;
      }
      remaining = onMenu.filter((m) => m.id !== swapped.id);
    } else {
      notes.push("The meal it replaces isn't on the menu for this kind of day, so nothing came off.");
    }
  } else {
    notes.push("Added on top rather than swapped in — the whole day has to make room for it.");
  }

  /* --- 2. shrink what can move ----------------------------------------- */

  /**
   * Locked and cooked-ahead are different kinds of "can't change it".
   *
   * A portion you locked is a decision: leave the meal alone entirely. A
   * portion already in a box is a fact: you can't re-weigh it, but you can
   * perfectly well not eat it and have it tomorrow instead. So a cooked-ahead
   * meal stays a candidate for dropping — `fitOneDay` is what stops it being
   * quietly resized — and only a deliberately locked one is set aside.
   */
  const fixedNames = new Set<number>();
  for (const m of remaining) {
    if (m.ingredients.every((i) => i.locked)) fixedNames.add(m.id);
  }

  let live = remaining.filter((m) => !fixedNames.has(m.id));
  const held = remaining.filter((m) => fixedNames.has(m.id));
  const heldMacros = held.reduce<Macros>(
    (a, m) => {
      const mm = macrosOf(m);
      return {
        kcal: a.kcal + mm.kcal,
        protein: a.protein + mm.protein,
        carbs: a.carbs + mm.carbs,
        fat: a.fat + mm.fat,
      };
    },
    { ...ZERO_MACROS }
  );

  const fixedIn = (): Macros => ({
    kcal: macros.kcal + heldMacros.kcal,
    protein: macros.protein + heldMacros.protein,
    carbs: macros.carbs + heldMacros.carbs,
    fat: macros.fat + heldMacros.fat,
  });

  let fit = fitOneDay(live, plan, dayTypeId, fixedIn(), supplements);
  const tolerance = Math.max(60, target.kcal * 0.03);
  const proteinFloor = target.protein * PROTEIN_FLOOR;

  /**
   * How much the rest of the week could take, before anything is dropped.
   *
   * This is the difference between a sensible absorber and a blunt one. A day
   * that is 400 kcal over does not need a meal removed if the four days after
   * it can each give up a hundred — energy balance is a weekly quantity, and
   * spreading is both gentler and more accurate than deleting your lunch. So
   * dropping only starts once the overshoot is bigger than the week can hold.
   */
  const spreadCapacity =
    rest.reduce((a, r) => a + targetsFor(plan, r.dayTypeId).kcal * SPREAD_CAP, 0) * SPREAD_SHARE;

  /* --- 3. drop meals, cheapest first ----------------------------------- */

  const dropped: PlanMeal[] = [];
  // Each pass through this loop is a full solve, and a day that needs five
  // meals removed is not a day this feature can rescue anyway.
  let guard = 0;
  while (
    fit.totals.kcal - target.kcal > tolerance + spreadCapacity &&
    live.length > 1 &&
    guard++ < 4
  ) {
    const over = fit.totals.kcal - target.kcal;

    // Rank what it would cost to lose each one. Low protein and no session to
    // fuel is a cheap drop; something close to the size of the overshoot is a
    // tidy one. Both matter, so both are in the score.
    const scored = live
      .map((m) => {
        const mm = macrosOf(m);
        if (mm.kcal <= 0) return null;
        const cost =
          proteinDensity(mm) * 3 +
          (isFuelling(m, dayTypes) ? 1.5 : 0) +
          Math.abs(mm.kcal - over) / Math.max(over, 1);
        // A lower bound: the re-fit that follows can grow what's left and win
        // some back, so a candidate that clears the floor on this figure has
        // certainly cleared it in reality.
        return { meal: m, kcal: mm.kcal, proteinAfter: fit.totals.protein - mm.protein, cost };
      })
      .filter(
        (x): x is { meal: PlanMeal; kcal: number; proteinAfter: number; cost: number } => x != null
      )
      .sort((a, b) => a.cost - b.cost);

    /**
     * Protein is a filter, not a term in the score.
     *
     * Left as a weighted term it loses: breakfast is 900 kcal of the 1200 you
     * need to find, and "close to the size of the overshoot" outvoted "half
     * the day's protein is in it". A cheat meal that quietly costs you 34 g of
     * protein is the exact failure this whole module exists to prevent, so the
     * meals that would cause it are removed from consideration entirely.
     *
     * And if that leaves nothing to drop, the loop stops rather than reaching
     * for the least-bad option. A very large meal out genuinely cannot be
     * absorbed by one day, and the two ways of saying so are not equal: a day
     * that is still over, spread and reported in grams of fat, is the truth.
     * A day that balances because breakfast, lunch and the pre-swim snack all
     * disappeared is a plan that has quietly decided you will train on a
     * curry. It used to do the second one.
     */
    const safe = scored.filter((x) => x.proteinAfter >= proteinFloor);
    const pick = safe[0];
    if (!pick) break;

    const next = live.filter((m) => m.id !== pick.meal.id);
    const trial = fitOneDay(next, plan, dayTypeId, fixedIn(), supplements);

    // Only drop it if doing so actually gets the day closer. Dropping a meal
    // that leaves the day *under* by more than it was over is not a fix.
    const nowOff = Math.abs(trial.totals.kcal - target.kcal);
    const wasOff = Math.abs(fit.totals.kcal - target.kcal);
    if (nowOff >= wasOff) break;
    if (trial.totals.kcal < target.kcal * DAY_FLOOR) break;

    dropped.push(pick.meal);
    live = next;
    fit = trial;
    const o = outcomes.get(pick.meal.id);
    if (o) {
      o.action = "dropped";
      o.after = { ...ZERO_MACROS };
      o.why = hasPrepped(pick.meal)
        ? "cooked ahead, so it can't be made smaller — leave the box for another day"
        : isFuelling(pick.meal, dayTypes)
          ? "dropped last, after everything else had moved"
          : "the cheapest thing to lose";
    }
  }

  /* --- record what the survivors came out at --------------------------- */

  for (const m of fit.meals) {
    const o = outcomes.get(m.id);
    if (!o || o.action === "dropped" || o.action === "replaced") continue;
    const was = onMenu.find((x) => x.id === m.id);
    if (!was) continue;
    const portions = m.ingredients
      .map((it, i) => ({
        name: it.name,
        from: Number(was.ingredients[i]?.grams ?? 0),
        to: Number(it.grams),
      }))
      .filter((p) => Math.abs(p.to - p.from) >= 1);
    if (portions.length) {
      o.action = "resized";
      o.portions = portions;
      o.after = macrosOf(m);
    }
  }
  for (const m of held) {
    const o = outcomes.get(m.id);
    if (o) o.why = "locked, so left alone";
  }
  for (const m of live) {
    const o = outcomes.get(m.id);
    if (!o || o.action === "dropped" || o.action === "replaced" || !hasPrepped(m)) continue;
    if (!o.why) o.why = "cooked ahead — the box is the size it is";
  }

  const cookedOnMenu = live.filter((m) => hasPrepped(m)).map((m) => m.name);
  if (cookedOnMenu.length) {
    notes.push(
      `${cookedOnMenu.join(" and ")} ${cookedOnMenu.length === 1 ? "was" : "were"} cooked and ` +
        `portioned on prep day, so ${cookedOnMenu.length === 1 ? "it holds" : "they hold"} ` +
        `at the planned weight. The day gives way in the food you plate fresh instead.`
    );
  }

  /* --- 4. spread what's left over the days that follow ------------------ */

  const spill = Math.max(0, Math.round(fit.totals.kcal - target.kcal));
  const spread: SpreadDay[] = [];
  let unplaced = spill;

  if (spill > 0 && rest.length) {
    // Proportional to each day's own size, so a rest day gives up less than a
    // double-swim day — but capped, so no single day carries the meal.
    const sizes = rest.map((r) => targetsFor(plan, r.dayTypeId).kcal);
    const totalSize = sizes.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < rest.length; i++) {
      if (unplaced <= 0) break;
      const share = (sizes[i] / totalSize) * spill;
      const cap = sizes[i] * SPREAD_CAP;
      const take = Math.round(Math.min(share, cap, unplaced));
      if (take < 10) continue;
      spread.push({
        day: rest[i].day,
        weekday: WEEKDAYS[(new Date(rest[i].day + "T12:00:00").getDay() + 6) % 7],
        dayTypeId: rest[i].dayTypeId,
        kcal: take,
      });
      unplaced -= take;
    }
  }

  /* --- 5. say what's left ---------------------------------------------- */

  const leftover = Math.max(0, Math.round(unplaced));

  if (spill === 0) {
    notes.push("The day absorbs it on its own — nothing carries into the rest of the week.");
  } else if (leftover === 0) {
    notes.push(
      `${spill} kcal spread over the next ${spread.length} day${spread.length === 1 ? "" : "s"}, ` +
        `no day giving up more than ${Math.round(SPREAD_CAP * 100)}% of its own.`
    );
  } else {
    notes.push(
      `${leftover} kcal has nowhere left to go — about ${Math.round(leftover / KCAL_PER_G_FAT)} g. ` +
        `That is the actual price of this one, and it is small; it is only worth watching if it becomes weekly.`
    );
  }

  if (fit.totals.protein < target.protein * 0.9) {
    notes.push(
      `Protein lands at ${Math.round(fit.totals.protein)} g against ${Math.round(target.protein)} g. ` +
        `Worth a shake — protein is the one thing that shouldn't pay for a meal out.`
    );
  }

  return {
    day: cheat.day,
    dayTypeId,
    target,
    cheat: macros,
    after: fit.totals,
    meals: [...outcomes.values()],
    spill,
    spread,
    leftover,
    leftoverFatGrams: Math.round(leftover / KCAL_PER_G_FAT),
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* The week around it                                                  */
/* ------------------------------------------------------------------ */

/**
 * The days that can take a share of the spill: the rest of this plan week.
 *
 * Stops at roll day, because the week after gets its own targets from its own
 * weigh-in and should not inherit a debt from this one. If the cheat meal
 * lands on a Sunday there is nowhere for it to go, and the honest thing is to
 * say so rather than to quietly borrow from next week.
 */
export function daysAfter(
  day: string,
  plan: WeekPlan,
  rollDow: number
): { day: string; dayTypeId: number }[] {
  const out: { day: string; dayTypeId: number }[] = [];
  const start = new Date(day + "T12:00:00");
  for (let i = 1; i <= 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (d.getDay() === rollDow) break;
    const key = d.toISOString().slice(0, 10);
    const weekday = WEEKDAYS[(d.getDay() + 6) % 7];
    const id = plan.week[weekday];
    if (id != null) out.push({ day: key, dayTypeId: id });
  }
  return out;
}

/** One cheat meal a week. Which one is in force on a given day. */
export function cheatForWeek(all: CheatMeal[], from: string, to: string): CheatMeal | null {
  const inWeek = all
    .filter((c) => c.day >= from && c.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day));
  return inWeek[inWeek.length - 1] ?? null;
}
