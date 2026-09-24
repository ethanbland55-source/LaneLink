/**
 * The weekly roll.
 *
 * Your weight moves every day and your plan must not. If targets tracked the
 * scale, Tuesday's porridge would be a different size from Monday's for
 * reasons that are mostly water, the shopping list would disagree with the
 * plan it was built from by Wednesday, and the containers in the fridge would
 * be wrong for the day they were opened.
 *
 * So the plan is built on a **snapshot**, taken once a week by the review the
 * day before shopping and brought into force on roll day (see "The weekly
 * review" below). Between rolls the numbers hold perfectly still: what you
 * bought is what you cook is what you eat.
 *
 * The trend, not the scale. A single reading is noise; the EWMA of the last
 * fortnight is the number that means something, and it's already corrected for
 * what time of day you weighed in (`lib/trend.ts`).
 */

import { WEEKDAYS, addDays, dayKey, type Profile, type Weekday } from "./nutrition";
import { isScan, trendLine, type WeighIn } from "./trend";
import type { Steer } from "./steer";

/** Sunday = 0 … Saturday = 6, matching `profile.shop_start_dow`. */
export function dowOf(day: string): number {
  return new Date(day + "T12:00:00").getDay();
}

export function weekdayNameOf(day: string): Weekday {
  return WEEKDAYS[(dowOf(day) + 6) % 7];
}

/** The most recent shopping day on or before `today`. */
export function lastShopDay(shopDow: number, today: string = dayKey()): string {
  const back = (dowOf(today) - shopDow + 7) % 7;
  return addDays(today, -back);
}

/** The next shopping day strictly after `today`. */
export function nextShopDay(shopDow: number, today: string = dayKey()): string {
  const ahead = (shopDow - dowOf(today) + 7) % 7;
  return addDays(today, ahead === 0 ? 7 : ahead);
}

/**
 * Shopping day and roll day are not the same day.
 *
 * You shop on Saturday, but Saturday and Sunday are still being eaten off the
 * *current* plan, and Sunday is when the next week gets cooked. If the plan
 * rolled the moment you got back from the shop, the containers still in the
 * fridge would be measured against numbers that had already moved on.
 *
 * So the shop looks forward — it buys for the week the food is for — and the
 * plan itself changes on roll day, by default the Monday. Everything between
 * the two days runs on the old numbers, which is what you're actually eating.
 */
export function lastRollDay(rollDow: number, today: string = dayKey()): string {
  const back = (dowOf(today) - rollDow + 7) % 7;
  return addDays(today, -back);
}

export function nextRollDay(rollDow: number, today: string = dayKey()): string {
  const ahead = (rollDow - dowOf(today) + 7) % 7;
  return addDays(today, ahead === 0 ? 7 : ahead);
}

/**
 * The day whose targets a shop on `today` should be built against — the roll
 * day the food will be eaten under, which is the next one unless today is it.
 */
export function planDayForShop(rollDow: number, today: string = dayKey()): string {
  return dowOf(today) === rollDow ? today : nextRollDay(rollDow, today);
}

/* ------------------------------------------------------------------ */
/* The weekly review                                                   */
/* ------------------------------------------------------------------ */

/**
 * When next week gets decided: the day before shopping.
 *
 * The decision used to be taken on roll day itself — Monday morning — which
 * is the one day it is guaranteed to be too late for. Saturday's shop had
 * already bought for the old portions and Sunday night's cooking had already
 * put them in boxes, so a change made on Monday landed on food that existed at
 * the wrong size. Ethan: *"the shopping list changes the day before it's due,
 * so we buy the right stuff ready for when we make it"* and *"as long as it
 * changes once we've had all our meals ticked off on the Sunday, that's
 * fine."*
 *
 * So there are now three moments a week, each doing one job:
 *
 *   - **Review day** (Friday, for a Saturday shop): the steer reads the scale,
 *     decides, re-fits, and stages the result for roll day. The shopping list
 *     reads staged portions, so from here it buys for next week.
 *   - **Shop day** (Saturday): buy it.
 *   - **Sunday evening**, once every meal that day is ticked off, or roll day
 *     morning if not: it comes into force, in time to cook to.
 *
 * Weigh-ins saved on review day re-run it, so a Friday morning scan counts.
 */
export function reviewDow(p: Pick<Profile, "shop_start_dow">): number {
  return (p.shop_start_dow + 6) % 7;
}

export function rollDowOf(p: Pick<Profile, "plan_roll_dow" | "shop_start_dow">): number {
  return p.plan_roll_dow ?? p.shop_start_dow;
}

/** The review day that belongs to a roll day: the last one before it. */
export function reviewDayFor(p: Profile, rollOn: string): string {
  const back = (rollDowOf(p) - reviewDow(p) + 7) % 7 || 7;
  return addDays(rollOn, -back);
}

export type ReviewSchedule = {
  /** The roll day the next decision is for. */
  rollOn: string;
  /** The day it gets made. */
  reviewOn: string;
  /** A decision for `rollOn` is already waiting. */
  staged: boolean;
  /** It should be made now. */
  due: boolean;
  /** When it would come into force if made now. */
  applyOn: string;
  /**
   * This week's own review never happened — the app wasn't opened from review
   * day to roll day — so the targets are a week stale. Then it runs now and
   * comes in straight away, which is what the weekly roll always did.
   */
  late: boolean;
};

export function reviewSchedule(p: Profile, today: string = dayKey()): ReviewSchedule {
  const rollDow = rollDowOf(p);
  const rollOn = planDayForShop(rollDow, today);
  const reviewOn = reviewDayFor(p, rollOn);
  const current = p.plan_updated_on != null && p.plan_updated_on >= rollOn;
  const staged =
    p.next_apply_on === rollOn && p.next_reviewed_on != null && p.next_reviewed_on >= reviewOn;
  const late =
    !current &&
    today < reviewOn &&
    (p.plan_updated_on == null || p.plan_updated_on < lastRollDay(rollDow, today));
  return {
    rollOn,
    reviewOn,
    staged,
    due: p.auto_roll && !current && (late || (today >= reviewOn && !staged)),
    applyOn: late ? today : rollOn,
    late,
  };
}

/**
 * The profile as next week will have it.
 *
 * What the shopping list and the Plan page's "next week" card are built
 * against once a review is waiting — the food being bought is for then.
 * Identical to `p` when nothing is.
 */
export function stagedProfile(p: Profile): Profile {
  if (!p.next_apply_on) return p;
  return {
    ...p,
    plan_weight_kg: p.next_plan_weight_kg ?? p.plan_weight_kg,
    plan_bf_pct: p.next_plan_bf_pct ?? p.plan_bf_pct,
    plan_bmr_kcal: p.next_plan_bmr_kcal ?? p.plan_bmr_kcal,
    recomp_adjust: p.next_recomp_adjust ?? p.recomp_adjust,
  };
}

export type RollFigures = {
  /** Trend weight, corrected for weigh-in time and smoothed. */
  weightKg: number;
  /** Latest measured body fat, if there is one. */
  bodyFatPct: number | null;
  /** The day the figures are for. */
  on: string;
  /** How many weigh-ins the trend rests on. */
  readings: number;
};

/**
 * The figures this week's plan should be built on.
 *
 * Returns null when there isn't enough to say anything — fewer than three
 * weigh-ins is a scale reading, not a trend, and rebuilding the plan around
 * one would be worse than leaving it alone.
 */
export function rollFigures(entries: WeighIn[], today: string = dayKey()): RollFigures | null {
  const usable = entries.filter((e) => e.weight_kg != null && Number(e.weight_kg) > 0);
  if (usable.length < 3) return null;

  const line = trendLine(entries);
  if (!line.length) return null;

  // Don't read the trend past today — a reading typed in for a future date
  // shouldn't decide this week's targets.
  const upTo = line.filter((p) => p.day <= today);
  const point = (upTo.length ? upTo : line)[Math.max(0, (upTo.length || line.length) - 1)];
  if (!point || !Number.isFinite(point.trend)) return null;

  // The most recent scan. A retired tape or caliper estimate is left where it
  // is: `applyRoll` falls back to whatever the plan already held, so an
  // account that has not scanned yet keeps the figure it has been using rather
  // than losing its body fat number the day this shipped.
  const withBf = entries
    .filter((e) => e.day <= today && isScan(e))
    .sort((a, b) => a.day.localeCompare(b.day));
  const last = withBf[withBf.length - 1] as any;

  return {
    weightKg: Math.round(point.trend * 10) / 10,
    bodyFatPct: last ? Number(last.bf_pct) : null,
    on: point.day,
    readings: usable.length,
  };
}

export type RollState = {
  /** The shopping day this week's plan should be built on. */
  dueOn: string;
  /** True when the snapshot is older than that and there is data to roll. */
  due: boolean;
  /** When the plan was last rebuilt. */
  lastRolled: string | null;
  /** The next shopping day, so the app can say when the plan changes next. */
  nextOn: string;
  figures: RollFigures | null;
  /** What the plan is being built on right now. */
  current: { weightKg: number; bodyFatPct: number | null; fromSnapshot: boolean };
};

/**
 * Where the weekly roll stands: what the plan is built on, whether that's
 * stale, and what it would become.
 */
export function rollState(
  profile: Profile,
  entries: WeighIn[],
  today: string = dayKey()
): RollState {
  // Roll day, not shopping day — see lastRollDay. Falls back to the shopping
  // day for a profile written before the two were separated.
  const rollDow = profile.plan_roll_dow ?? profile.shop_start_dow;
  const dueOn = lastRollDay(rollDow, today);
  const figures = rollFigures(entries, today);
  const lastRolled = profile.plan_updated_on ?? null;

  return {
    dueOn,
    nextOn: nextRollDay(rollDow, today),
    lastRolled,
    due: !!figures && (lastRolled == null || lastRolled < dueOn),
    figures,
    current: {
      weightKg: planningWeight(profile),
      bodyFatPct: planningBodyFat(profile),
      fromSnapshot: profile.plan_weight_kg != null && profile.plan_weight_kg > 0,
    },
  };
}

/**
 * The weight the plan is built on.
 *
 * The snapshot when there is one, the typed-in figure until then — so a brand
 * new account works from the number you gave it and quietly switches to your
 * own trend once there's a fortnight of it.
 */
export function planningWeight(p: Profile): number {
  return p.plan_weight_kg != null && p.plan_weight_kg > 0 ? p.plan_weight_kg : p.weight_kg;
}

/** The same for body fat: the rolled figure, else whatever the profile knows. */
export function planningBodyFat(p: Profile): number | null {
  if (p.plan_bf_pct != null && p.plan_bf_pct > 0) return p.plan_bf_pct;
  return p.body_fat_pct != null && p.body_fat_pct > 0 ? p.body_fat_pct : null;
}

/**
 * The profile as it would be after rolling. Pure — the caller does the writing.
 *
 * Two things move on roll day and they are separate decisions. The snapshot
 * says what body the week is planned for; the steer says how many calories
 * that week is worth, given what the last month of scans actually did. Passing
 * the steer is optional so that the tests, and anything that only wants the
 * snapshot, can roll without one.
 */
export function applyRoll(
  p: Profile,
  figures: RollFigures,
  dueOn: string,
  steer?: Steer
): Profile {
  return {
    ...p,
    plan_weight_kg: figures.weightKg,
    plan_bf_pct: figures.bodyFatPct ?? p.plan_bf_pct,
    plan_updated_on: dueOn,
    recomp_adjust: steer ? steer.next : p.recomp_adjust,
  };
}

/** How much the roll would move things, for the line that explains it. */
export function rollDelta(p: Profile, figures: RollFigures): { kg: number; bf: number | null } {
  return {
    kg: Math.round((figures.weightKg - planningWeight(p)) * 10) / 10,
    bf:
      figures.bodyFatPct != null && planningBodyFat(p) != null
        ? Math.round((figures.bodyFatPct - (planningBodyFat(p) as number)) * 10) / 10
        : null,
  };
}
