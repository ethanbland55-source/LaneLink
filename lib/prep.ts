/**
 * Meal prep guide — how much food a plan actually is.
 *
 * Macros tell you nothing about whether a meal will hold you until the next
 * one. The number that does is **energy density**: calories per 100 g of the
 * food as it reaches the plate. Barbara Rolls' volumetrics work put the
 * boundary for "this fills you up" at roughly 125 kcal/100 g, and every
 * satiety-index study since has broadly agreed — water and fibre take up room,
 * fat doesn't.
 *
 * So this module converts a plan from raw grams into what you'll be looking
 * at: cooked weight, rough plate volume, energy density, and a verdict. And
 * when the numbers say a meal is small and dense, it suggests what to add.
 */

import { profileFor, VOLUME_FOODS } from "./foods";
import type { Item, Macros } from "./nutrition";
import { itemMacros, sumMacros, ZERO_MACROS } from "./nutrition";

export type Verdict = "very filling" | "filling" | "moderate" | "dense" | "very dense";

export const VERDICTS: { verdict: Verdict; upTo: number; blurb: string }[] = [
  { verdict: "very filling", upTo: 90, blurb: "mostly water and fibre" },
  { verdict: "filling", upTo: 150, blurb: "plenty of food for the calories" },
  { verdict: "moderate", upTo: 250, blurb: "a normal plate" },
  { verdict: "dense", upTo: 400, blurb: "small for the calories" },
  { verdict: "very dense", upTo: Infinity, blurb: "very little food for the calories" },
];

export function verdictFor(kcalPer100g: number): (typeof VERDICTS)[number] {
  return VERDICTS.find((v) => kcalPer100g <= v.upTo) ?? VERDICTS[VERDICTS.length - 1];
}

export type ItemVolume = {
  name: string;
  rawGrams: number;
  cookedGrams: number;
  volumeMl: number;
  /** Only worth telling the user about when it isn't 1. */
  rawToCooked: number;
  unit: { grams: number; name: string; count: number } | null;
};

export type MealVolume = {
  name: string;
  items: ItemVolume[];
  rawGrams: number;
  cookedGrams: number;
  volumeMl: number;
  macros: Macros;
  kcalPer100g: number;
  verdict: Verdict;
  blurb: string;
  notes: string[];
};

export function itemVolume(it: Item): ItemVolume {
  const p = profileFor(it.name, it);
  const raw = Math.max(0, Number(it.grams) || 0);
  const cooked = raw * p.rawToCooked;
  return {
    name: it.name,
    rawGrams: raw,
    cookedGrams: cooked,
    volumeMl: cooked * p.mlPerG,
    rawToCooked: p.rawToCooked,
    unit: p.unitGrams
      ? { grams: p.unitGrams, name: p.unitName ?? "unit", count: raw / p.unitGrams }
      : null,
  };
}

export function mealVolume(name: string, items: Item[]): MealVolume {
  const vols = items.map(itemVolume);
  const macros = sumMacros(items.map(itemMacros));
  const cookedGrams = vols.reduce((a, v) => a + v.cookedGrams, 0);
  const rawGrams = vols.reduce((a, v) => a + v.rawGrams, 0);
  const volumeMl = vols.reduce((a, v) => a + v.volumeMl, 0);
  const kcalPer100g = cookedGrams > 0 ? (macros.kcal / cookedGrams) * 100 : 0;
  const v = verdictFor(kcalPer100g);

  const notes: string[] = [];
  for (const iv of vols) {
    if (iv.rawToCooked >= 2 && iv.rawGrams > 0) {
      notes.push(
        `${iv.name}: ${Math.round(iv.rawGrams)} g dry cooks up to about ${Math.round(iv.cookedGrams)} g.`
      );
    } else if (iv.rawToCooked <= 0.85 && iv.rawGrams >= 60) {
      notes.push(
        `${iv.name}: weigh ${Math.round(iv.rawGrams)} g raw — about ${Math.round(iv.cookedGrams)} g once cooked.`
      );
    }
    if (iv.unit && iv.rawGrams > 0) {
      const c = iv.unit.count;
      const rounded = Math.round(c * 2) / 2;
      notes.push(`${iv.name}: ${rounded} ${iv.unit.name}${rounded === 1 ? "" : "s"}.`);
    }
  }

  return {
    name,
    items: vols,
    rawGrams,
    cookedGrams,
    volumeMl,
    macros,
    kcalPer100g,
    verdict: v.verdict,
    blurb: v.blurb,
    notes,
  };
}

export type DayVolume = {
  meals: MealVolume[];
  cookedGrams: number;
  volumeMl: number;
  kcal: number;
  kcalPer100g: number;
  verdict: Verdict;
  blurb: string;
  /** Meals ordered by how dense they are — the first is the one to fix. */
  densest: MealVolume[];
};

export function dayVolume(meals: { name: string; ingredients: Item[] }[]): DayVolume {
  const mv = meals.map((m) => mealVolume(m.name, m.ingredients));
  const cookedGrams = mv.reduce((a, m) => a + m.cookedGrams, 0);
  const volumeMl = mv.reduce((a, m) => a + m.volumeMl, 0);
  const kcal = mv.reduce((a, m) => a + m.macros.kcal, 0);
  const kcalPer100g = cookedGrams > 0 ? (kcal / cookedGrams) * 100 : 0;
  const v = verdictFor(kcalPer100g);
  return {
    meals: mv,
    cookedGrams,
    volumeMl,
    kcal,
    kcalPer100g,
    verdict: v.verdict,
    blurb: v.blurb,
    densest: [...mv].sort((a, b) => b.kcalPer100g - a.kcalPer100g),
  };
}

export type Filler = {
  name: string;
  grams: number;
  macros: Macros;
  /** Why this one — the macro it helps with most. */
  reason: string;
};

/**
 * What to add when there are calories spare but not much food.
 *
 * Picks from the volume foods, preferring whichever also helps the macro
 * that's furthest short, and sizes the portion to use about half of the
 * remaining calories so there's still room to adjust elsewhere.
 */
export function fillerSuggestions(current: Macros, target: Macros, max = 3): Filler[] {
  const headroom = target.kcal - current.kcal;
  if (headroom < 60) return [];

  const shortProtein = target.protein - current.protein;
  const shortFibre = target.fibre - current.fibre;

  const scored = VOLUME_FOODS.map((f) => {
    const budget = headroom * 0.5;
    const grams = Math.max(50, Math.min(400, Math.round((budget / Math.max(f.kcal_100, 1)) * 100 / 10) * 10));
    const k = grams / 100;
    const macros: Macros = {
      kcal: f.kcal_100 * k,
      protein: f.protein_100 * k,
      carbs: f.carbs_100 * k,
      fat: f.fat_100 * k,
      fibre: f.fibre_100 * k,
    };
    let score = macros.fibre * 1.0;
    if (shortProtein > 5) score += macros.protein * 1.5;
    if (shortFibre > 5) score += macros.fibre * 1.5;
    score += (grams - macros.kcal / 2) / 100; // reward bulk per calorie

    const reason =
      shortProtein > 5 && macros.protein > 8
        ? `+${Math.round(macros.protein)} g protein for ${Math.round(macros.kcal)} kcal`
        : `${grams} g of food for ${Math.round(macros.kcal)} kcal`;

    return { name: f.name, grams, macros, reason, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ name, grams, macros, reason }) => ({ name, grams, macros, reason }));
}

/** A one-line summary for the plan header. */
export function volumeHeadline(dv: DayVolume): string {
  if (dv.cookedGrams <= 0) return "Add some ingredients to see how much food this is.";
  const kg = (dv.cookedGrams / 1000).toFixed(1);
  return `${kg} kg of food across ${dv.meals.length} meal${dv.meals.length === 1 ? "" : "s"} · ${Math.round(dv.kcalPer100g)} kcal per 100 g · ${dv.verdict}`;
}

export const EMPTY_DAY_VOLUME: DayVolume = {
  meals: [],
  cookedGrams: 0,
  volumeMl: 0,
  kcal: 0,
  kcalPer100g: 0,
  verdict: "moderate",
  blurb: "",
  densest: [],
};

export const _ZERO = ZERO_MACROS;
