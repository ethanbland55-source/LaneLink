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
