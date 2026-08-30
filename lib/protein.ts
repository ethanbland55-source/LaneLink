/**
 * Where the protein sits.
 *
 * Hitting 160 g in two enormous sittings is not the same day as hitting 160 g
 * across four. Each dose has to clear a threshold — roughly 0.4 g/kg of
 * bodyweight — before it raises muscle protein synthesis at all; under that
 * the amino acids are still used, the signal just isn't sent. Four or five
 * doses, one near training and one before sleep, is where the physique
 * literature lands.
 *
 * It matters most in exactly the situation this app is being used for: holding
 * weight steady while composition changes. The daily total is doing the work,
 * and the distribution is what stops that work being wasted.
 */

import { PROTEIN_DOSES_TARGET, PROTEIN_PER_MEAL_G_PER_KG, totalFor, type Item } from "./nutrition";

export type MealProtein = {
  id: number;
  name: string;
  protein: number;
  /** Multiples of the per-meal threshold this dose is worth. */
  doses: number;
  clears: boolean;
  /** Grams that would need adding for it to count. */
  shortBy: number;
};

export type Distribution = {
  thresholdG: number;
  meals: MealProtein[];
  clearing: number;
  target: number;
  total: number;
  ok: boolean;
  notes: string[];
};

export function proteinDistribution(
  meals: { id: number; name: string; times_per_day?: number; ingredients: Item[] }[],
  weightKg: number
): Distribution {
  const thresholdG = PROTEIN_PER_MEAL_G_PER_KG * weightKg;

  const rows: MealProtein[] = [];
  for (const m of meals) {
    const per = totalFor(m.ingredients).protein;
    const reps = Math.max(1, Math.round(Number(m.times_per_day ?? 1)));
    // A meal eaten twice is two separate doses, not one big one.
    for (let i = 0; i < reps; i++) {
      rows.push({
        id: m.id,
        name: reps > 1 ? `${m.name} (${i + 1} of ${reps})` : m.name,
        protein: per,
        doses: thresholdG > 0 ? per / thresholdG : 0,
        clears: per >= thresholdG - 0.5,
        shortBy: Math.max(0, thresholdG - per),
      });
    }
  }

  const clearing = rows.filter((r) => r.clears).length;
  const total = rows.reduce((a, r) => a + r.protein, 0);

  const notes: string[] = [];
  if (rows.length === 0) {
    notes.push("No meals yet.");
  } else {
    if (clearing < PROTEIN_DOSES_TARGET) {
      const closest = rows
        .filter((r) => !r.clears && r.protein > 0)
        .sort((a, b) => a.shortBy - b.shortBy)
        .slice(0, 2);
      if (closest.length) {
        notes.push(
          `${clearing} of your ${rows.length} meals clear ${Math.round(thresholdG)} g. ` +
            closest
              .map((c) => `${c.name} is ${Math.round(c.shortBy)} g short`)
              .join(", ") +
            "."
        );
      } else {
        notes.push(
          `${clearing} of ${PROTEIN_DOSES_TARGET} useful doses — spread the protein across more meals.`
        );
      }
    }
    const biggest = [...rows].sort((a, b) => b.doses - a.doses)[0];
    if (biggest && biggest.doses > 2.2) {
      notes.push(
        `${biggest.name} carries ${Math.round(biggest.protein)} g on its own. Moving some of it to another meal buys you an extra dose for free.`
      );
    }
    if (clearing >= PROTEIN_DOSES_TARGET) {
      notes.push(
        `${clearing} doses over ${Math.round(thresholdG)} g — that's the spread you want. Keep one of them within a couple of hours of sleep.`
      );
    }
  }

  return {
    thresholdG,
    meals: rows,
    clearing,
    target: PROTEIN_DOSES_TARGET,
    total,
    ok: clearing >= PROTEIN_DOSES_TARGET,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* When you ate it                                                     */
/* ------------------------------------------------------------------ */

export type TimedMeal = { name: string; protein: number; at: string | null };

export type Spacing = {
  /** Doses that cleared the threshold, in the order they were eaten. */
  timed: { name: string; protein: number; hour: number; clears: boolean }[];
  /** Hours between consecutive timed doses. */
  gaps: number[];
  longestGap: number;
  /** Hours from the last dose of the day to a typical bedtime. */
  hoursBeforeBed: number | null;
  notes: string[];
};

/** Bedtime the last dose is measured against, when nothing better is known. */
export const ASSUMED_BEDTIME_HOUR = 23;

/**
 * How the day's protein was spread across it.
 *
 * The daily total is doing the work and the spacing decides how much of that
 * work lands. Muscle protein synthesis rises for roughly three hours after a
 * dose that clears the threshold and then settles back whether or not more
 * protein arrives — so four doses three to five hours apart raise it four
 * times, and the same protein in two sittings raises it twice.
 *
 * The last dose is worth its own mention: the overnight fast is the longest
 * one of the day, and a dose within a couple of hours of sleep is the cheapest
 * way to shorten it.
 *
 * Only meals you gave a time to can be placed, which is the honest limit here:
 * this says nothing at all until you start logging times.
 */
export function doseSpacing(meals: TimedMeal[], weightKg: number): Spacing {
  const thresholdG = PROTEIN_PER_MEAL_G_PER_KG * weightKg;

  const timed = meals
    .map((m) => {
      const at = m.at ? /^(\d{1,2}):(\d{2})$/.exec(m.at) : null;
      if (!at) return null;
      const hour = Number(at[1]) + Number(at[2]) / 60;
      return { name: m.name, protein: m.protein, hour, clears: m.protein >= thresholdG - 0.5 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.hour - b.hour);

  const clearing = timed.filter((d) => d.clears);
  const gaps: number[] = [];
  for (let i = 1; i < clearing.length; i++) gaps.push(clearing[i].hour - clearing[i - 1].hour);

  const last = clearing[clearing.length - 1];
  const hoursBeforeBed = last ? ASSUMED_BEDTIME_HOUR - last.hour : null;

  const notes: string[] = [];
  if (timed.length === 0) {
    return { timed, gaps, longestGap: 0, hoursBeforeBed: null, notes };
  }

  const longestGap = gaps.length ? Math.max(...gaps) : 0;

  if (gaps.length && longestGap > 6) {
    const at = gaps.indexOf(longestGap);
    notes.push(
      `${longestGap.toFixed(1)} hours between ${clearing[at].name.toLowerCase()} and ${clearing[
        at + 1
      ].name.toLowerCase()} — the longest gap of the day. Three to five hours is where you'd want it.`
    );
  } else if (gaps.length >= 2) {
    notes.push(`Evenly spread — nothing more than ${longestGap.toFixed(1)} hours apart.`);
  }

  if (hoursBeforeBed != null && hoursBeforeBed > 5) {
    notes.push(
      `Last real dose was ${last.name.toLowerCase()} at ${clock(last.hour)}, about ${hoursBeforeBed.toFixed(0)} hours before sleep. Something with protein in it later would shorten the overnight fast.`
    );
  } else if (hoursBeforeBed != null && hoursBeforeBed >= 0 && hoursBeforeBed <= 3) {
    notes.push(`Last dose at ${clock(last.hour)} — close enough to sleep to be worth having.`);
  }

  return { timed, gaps, longestGap, hoursBeforeBed, notes };
}

function clock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
