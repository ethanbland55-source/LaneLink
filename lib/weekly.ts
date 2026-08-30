/**
 * The weekly roll.
 *
 * Your weight moves every day and your plan must not. If targets tracked the
 * scale, Tuesday's porridge would be a different size from Monday's for
 * reasons that are mostly water, the shopping list would disagree with the
 * plan it was built from by Wednesday, and the containers in the fridge would
 * be wrong for the day they were opened.
 *
 * So the plan is built on a **snapshot**, and the snapshot is taken once a
 * week on shopping day. Between rolls the numbers hold perfectly still: what
 * you bought is what you cook is what you eat. On shopping day the trend
 * weight and the latest body fat figure are read once, the targets are rebuilt
 * around them, and that is the week you then shop for.
 *
 * The trend, not the scale. A single reading is noise; the EWMA of the last
 * fortnight is the number that means something, and it's already corrected for
 * what time of day you weighed in (`lib/trend.ts`).
 */

import { WEEKDAYS, addDays, dayKey, type Profile, type Weekday } from "./nutrition";
import { trendLine, type WeighIn } from "./trend";

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

  // The most recent body fat figure, whichever method produced it.
  const withBf = entries
    .filter((e) => e.day <= today && (e as any).bf_pct != null)
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
  const dueOn = lastShopDay(profile.shop_start_dow, today);
  const figures = rollFigures(entries, today);
  const lastRolled = profile.plan_updated_on ?? null;

  return {
    dueOn,
    nextOn: nextShopDay(profile.shop_start_dow, today),
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

/** The profile as it would be after rolling. Pure — the caller does the writing. */
export function applyRoll(p: Profile, figures: RollFigures, dueOn: string): Profile {
  return {
    ...p,
    plan_weight_kg: figures.weightKg,
    plan_bf_pct: figures.bodyFatPct ?? p.plan_bf_pct,
    plan_updated_on: dueOn,
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
