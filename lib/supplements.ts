/**
 * Supplements.
 *
 * They are not ingredients, and modelling them as ingredients would break two
 * things at once. The optimiser would resize your creatine to help hit a carb
 * target, and the shopping list would try to buy 5 g of it. So a supplement is
 * a **fixed dose**: it contributes whatever macros it contributes, it gets
 * ticked off rather than weighed, and the fit treats it as part of the day it
 * cannot negotiate with.
 *
 * The library below is graded, and the grades are the point. Creatine and
 * vitamin D3 are not the same proposition as K2, and a list that presents them
 * identically is worse than no list — it launders the weak ones. Grades follow
 * the IOC consensus statement and the IJSNEM review that sits alongside it,
 * both of which are deliberately unkind.
 *
 * Nothing here is medical advice, and the app says so where it matters: a
 * supplement that corrects a deficiency needs the deficiency established by a
 * blood test, not by an app.
 */

import type { Grade } from "./evidence";

export type SuppUnit = "g" | "mg" | "mcg" | "IU" | "capsule" | "scoop" | "ml";

export type SuppTiming = "anytime" | "with_food" | "pre_session" | "post_session" | "evening";

export const TIMING_LABEL: Record<SuppTiming, string> = {
  anytime: "Any time",
  with_food: "With food",
  pre_session: "Before training",
  post_session: "After training",
  evening: "Evening",
};

export type SuppSpec = {
  name: string;
  dose: number;
  unit: SuppUnit;
  timing: SuppTiming;
  grade: Grade;
  /** Per dose. Almost always zero, but a few carry real calories. */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** What it does, in a sentence, without overselling it. */
  what: string;
  /** Why it matters to a swimmer specifically, where it does. */
  swimming?: string;
  /** The honest caveat. */
  caveat?: string;
  refs: string[];
};

/**
 * The library you can pick from. Doses are the ones the cited work used, not
 * the ones on the tub — a scoop is whatever the manufacturer decided.
 */
export const SUPPLEMENT_LIBRARY: SuppSpec[] = [
  {
    name: "Creatine monohydrate",
    dose: 5,
    unit: "g",
    timing: "anytime",
    grade: "strong",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "Refills phosphocreatine, the fuel for efforts under about 30 seconds. Raises repeat-sprint work and training quality, and helps a little with lean mass.",
    swimming:
      "The clearest wins are in sprint and repeat-sprint work — starts, turns, 50s and 100s, and holding pace across a hard set rather than one swim.",
    caveat:
      "Expect 1–2 kg of intracellular water in the first weeks. That is not fat, but it will show on the scale and drag the trend — worth knowing before you read anything into it.",
    refs: ["kreider2017", "maughan2018", "peeling2018"],
  },
  {
    name: "Vitamin D3",
    dose: 1000,
    unit: "IU",
    timing: "with_food",
    grade: "moderate",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "Corrects a shortfall. Where one exists, fixing it supports bone health, muscle function and immune resilience.",
    swimming:
      "Indoor athletes are the classic at-risk group — training under a roof, at British latitude, through a winter. Swimmers turn up in the deficiency literature repeatedly.",
    caveat:
      "This is a repletion effect, not a performance one: topping up someone already replete does nothing measurable. Fat-soluble, so more is not better. Worth an actual blood test.",
    refs: ["owens2018", "maughan2018"],
  },
  {
    name: "Vitamin K2 (MK-7)",
    dose: 100,
    unit: "mcg",
    timing: "with_food",
    grade: "insufficient",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "Directs calcium to bone rather than soft tissue. Usually taken alongside D3 for that reason.",
    caveat:
      "No good evidence of any athletic performance effect. It is in this list because people take it with D3, not because it earns a place on its own.",
    refs: ["maughan2018"],
  },
  {
    name: "Magnesium",
    dose: 300,
    unit: "mg",
    timing: "evening",
    grade: "limited",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "Involved in muscle contraction and energy metabolism. Supplementing helps where intake is genuinely low.",
    caveat:
      "In athletes eating enough food, supplementing on top has not been shown to improve performance or sleep reliably. Heavy sweating raises requirements a little, not dramatically.",
    refs: ["maughan2018", "thomas2016"],
  },
  {
    name: "Caffeine",
    dose: 200,
    unit: "mg",
    timing: "pre_session",
    grade: "strong",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "3–6 mg/kg an hour before. Lowers perceived effort and improves endurance and repeat-sprint performance.",
    swimming: "Holds up across sprint and middle-distance swimming. One of the few that reliably shows up in the pool.",
    caveat:
      "Wrecks sleep taken late, and sleep is doing more for you than the caffeine is. Not for an evening session unless you have tested it.",
    refs: ["maughan2018", "peeling2018"],
  },
  {
    name: "Beta-alanine",
    dose: 4,
    unit: "g",
    timing: "with_food",
    grade: "moderate",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "Raises muscle carnosine over weeks, buffering the acidity that builds in efforts of roughly 1–4 minutes.",
    swimming:
      "That window is a 100 or a 200 almost exactly, which is why it appears in swimming protocols more than in most sports.",
    caveat: "Needs 4–10 weeks of daily loading to do anything. Causes harmless skin tingling.",
    refs: ["maughan2018", "peeling2018"],
  },
  {
    name: "Sodium bicarbonate",
    dose: 0.3,
    unit: "g",
    timing: "pre_session",
    grade: "moderate",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "0.3 g/kg, 60–150 minutes before. Buffers outside the muscle where beta-alanine buffers inside it.",
    swimming: "Same 1–4 minute window — raced events rather than training days.",
    caveat:
      "Gut upset is common and can be race-ruining. Only ever used on a day you have rehearsed it.",
    refs: ["maughan2018", "peeling2018"],
  },
  {
    name: "Whey protein",
    dose: 30,
    unit: "g",
    timing: "post_session",
    grade: "strong",
    kcal: 120,
    protein: 25,
    carbs: 2,
    fat: 1.5,
    what: "A convenient way to reach a daily protein target and to place a dose where whole food is awkward.",
    caveat:
      "Convenience, not magic — it does nothing food of the same protein content wouldn't. If it's a real part of a meal, add it as an ingredient so the fit can size it.",
    refs: ["jager2017", "morton2018"],
  },
  {
    name: "Omega-3 (EPA/DHA)",
    dose: 2,
    unit: "g",
    timing: "with_food",
    grade: "limited",
    kcal: 18,
    protein: 0,
    carbs: 0,
    fat: 2,
    what: "Combined EPA + DHA. General cardiovascular and inflammatory support where oily fish intake is low.",
    caveat:
      "Evidence for a direct performance or recovery effect in athletes is mixed. Two portions of oily fish a week gets you the same thing.",
    refs: ["maughan2018", "thomas2016"],
  },
  {
    name: "Iron",
    dose: 100,
    unit: "mg",
    timing: "with_food",
    grade: "moderate",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    what: "Corrects iron deficiency, which flattens endurance performance well before it becomes anaemia.",
    caveat:
      "Only on a blood test showing you need it. Iron is genuinely harmful in excess and supplementing blind is the wrong call — this one belongs to a doctor, not an app.",
    refs: ["thomas2016", "maughan2018"],
  },
];

export function specFor(name: string): SuppSpec | null {
  const k = name.trim().toLowerCase();
  return SUPPLEMENT_LIBRARY.find((s) => s.name.toLowerCase() === k) ?? null;
}

/** What one supplement adds to a day, macro-wise. Usually nothing. */
export type Supplement = {
  id: number;
  name: string;
  dose: number;
  unit: SuppUnit;
  timing: SuppTiming;
  /** Which meal it's taken with, if any. */
  meal_id: number | null;
  /** Which day types it's taken on. Null = every day. */
  day_type_ids: number[] | null;
  times_per_day: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  note: string | null;
  sort_order: number;
};

export function repsOf(s: Supplement): number {
  return Math.max(1, Math.round(Number(s.times_per_day ?? 1)));
}

/** Does this supplement belong on this kind of day? */
export function suppAppliesOn(s: Supplement, dayTypeId: number, totalTypes: number): boolean {
  const ids = s.day_type_ids;
  if (!ids || ids.length === 0 || ids.length >= totalTypes) return true;
  return ids.includes(dayTypeId);
}

/**
 * The macros a day's supplements add, which the fit must not try to change.
 *
 * Almost always zero — creatine, D3, K2 and magnesium contribute nothing at
 * all. It matters for the handful that do: a 30 g whey scoop is 120 kcal and
 * 25 g of protein, and a plan that ignores it is a plan that is 25 g of
 * protein wrong every day.
 */
export function fixedMacros(
  supps: Supplement[],
  dayTypeId: number,
  totalTypes: number
): { kcal: number; protein: number; carbs: number; fat: number } {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const s of supps) {
    if (!suppAppliesOn(s, dayTypeId, totalTypes)) continue;
    const n = repsOf(s);
    out.kcal += (Number(s.kcal) || 0) * n;
    out.protein += (Number(s.protein) || 0) * n;
    out.carbs += (Number(s.carbs) || 0) * n;
    out.fat += (Number(s.fat) || 0) * n;
  }
  return out;
}

/** "5 g", "1,000 IU", "1 capsule". */
export function doseLabel(s: { dose: number; unit: SuppUnit }): string {
  const d = Number(s.dose) || 0;
  const n = d >= 1000 ? d.toLocaleString() : String(Math.round(d * 100) / 100);
  if (s.unit === "capsule") return `${n} capsule${d === 1 ? "" : "s"}`;
  if (s.unit === "scoop") return `${n} scoop${d === 1 ? "" : "s"}`;
  return `${n} ${s.unit}`;
}
