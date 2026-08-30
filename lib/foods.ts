/**
 * Food knowledge.
 *
 * The optimiser used to know nothing about what it was resizing: every
 * ingredient got the same blind 60%–150% band around whatever was already in
 * the plan. That produces silly answers — it will happily push olive oil from
 * 10 g to 15 g (a 50% swing in a pure fat source) while treating "1 banana" as
 * a continuous quantity you can weigh out to 137 g.
 *
 * This module gives every ingredient a *class*, and every class an opinion:
 *
 *  - how far the portion may realistically move (`flex`),
 *  - whether it comes in indivisible units (an egg, a slice, a scoop),
 *  - what it weighs after cooking (`rawToCooked`),
 *  - how much room it takes on the plate (`mlPerG`) and how filling it is
 *    per calorie (`satiety`),
 *  - which aisle it's in and what size the packet usually is, which is what
 *    makes the shopping list buyable rather than a list of odd gram totals.
 *
 * Classification is name-first (a dictionary of the things people actually
 * eat) with a macro-density fallback, so an ingredient the dictionary has
 * never heard of still lands somewhere sensible.
 */

export type FoodClass =
  | "lean_protein"
  | "fatty_protein"
  | "oily_fish"
  | "egg"
  | "dairy_high_protein"
  | "dairy_fatty"
  | "milk"
  | "grain"
  | "bread"
  | "starchy_veg"
  | "veg"
  | "fruit"
  | "legume"
  | "nut_seed"
  | "fat_oil"
  | "sauce"
  | "supplement"
  | "sweet"
  | "drink"
  | "other";

export type Aisle =
  | "Produce"
  | "Meat & fish"
  | "Dairy & eggs"
  | "Bakery"
  | "Cupboard"
  | "Frozen"
  | "Drinks"
  | "Other";

export const AISLE_ORDER: Aisle[] = [
  "Produce",
  "Meat & fish",
  "Dairy & eggs",
  "Bakery",
  "Cupboard",
  "Frozen",
  "Drinks",
  "Other",
];

export type ClassSpec = {
  label: string;
  aisle: Aisle;
  /** Portion band as multipliers of the planned amount. */
  flex: [number, number];
  /** Never go below this many grams if the ingredient is in the plan at all. */
  floor: number;
  /** Weighing granularity in grams. */
  step: number;
  /** Cooked weight ÷ raw weight. 1 = eaten as bought. */
  rawToCooked: number;
  /** Rough volume on the plate, ml per gram of the ready-to-eat food. */
  mlPerG: number;
  /**
   * Fullness per calorie, relative to white bread = 1.0. Loosely follows the
   * Holt et al. satiety index: protein and water-heavy foods score high, oils
   * and refined sugar score near zero.
   */
  satiety: number;
  /** Days it keeps once bought — drives the "buy twice" flag on long shops. */
  shelfDays: number;
  /** Typical supermarket pack, for rounding the shopping list. */
  packGrams: number;
};

export const CLASSES: Record<FoodClass, ClassSpec> = {
  lean_protein: {
    label: "Lean protein",
    aisle: "Meat & fish",
    flex: [0.7, 1.45],
    floor: 40,
    step: 5,
    rawToCooked: 0.74,
    mlPerG: 0.95,
    satiety: 2.1,
    shelfDays: 3,
    packGrams: 300,
  },
  fatty_protein: {
    label: "Fattier protein",
    aisle: "Meat & fish",
    flex: [0.75, 1.3],
    floor: 40,
    step: 5,
    rawToCooked: 0.7,
    mlPerG: 0.95,
    satiety: 1.7,
    shelfDays: 3,
    packGrams: 400,
  },
  oily_fish: {
    label: "Oily fish",
    aisle: "Meat & fish",
    flex: [0.8, 1.25],
    floor: 50,
    step: 5,
    rawToCooked: 0.8,
    mlPerG: 0.95,
    satiety: 1.9,
    shelfDays: 2,
    packGrams: 240,
  },
  egg: {
    label: "Eggs",
    aisle: "Dairy & eggs",
    flex: [0.66, 1.5],
    floor: 50,
    step: 1,
    rawToCooked: 0.9,
    mlPerG: 1.0,
    satiety: 1.9,
    shelfDays: 21,
    packGrams: 348, // 6 medium eggs
  },
  dairy_high_protein: {
    label: "High-protein dairy",
    aisle: "Dairy & eggs",
    flex: [0.6, 1.7],
    floor: 50,
    step: 5,
    rawToCooked: 1,
    mlPerG: 0.95,
    satiety: 1.8,
    shelfDays: 10,
    packGrams: 450,
  },
  dairy_fatty: {
    label: "Cheese & butter",
    aisle: "Dairy & eggs",
    flex: [0.7, 1.25],
    floor: 10,
    step: 5,
    rawToCooked: 1,
    mlPerG: 0.9,
    satiety: 0.9,
    shelfDays: 21,
    packGrams: 200,
  },
  milk: {
    label: "Milk",
    aisle: "Dairy & eggs",
    flex: [0.6, 1.6],
    floor: 50,
    step: 10,
    rawToCooked: 1,
    mlPerG: 0.97,
    satiety: 1.4,
    shelfDays: 7,
    packGrams: 2272, // 4 pints
  },
  grain: {
    label: "Grains & pasta",
    aisle: "Cupboard",
    flex: [0.65, 1.6],
    floor: 20,
    step: 5,
    rawToCooked: 2.6,
    mlPerG: 1.15,
    satiety: 1.5,
    shelfDays: 365,
    packGrams: 500,
  },
  bread: {
    label: "Bread",
    aisle: "Bakery",
    flex: [0.7, 1.5],
    floor: 20,
    step: 5,
    rawToCooked: 1,
    mlPerG: 2.6,
    satiety: 1.0,
    shelfDays: 5,
    packGrams: 800,
  },
  starchy_veg: {
    label: "Starchy veg",
    aisle: "Produce",
    flex: [0.6, 1.8],
    floor: 50,
    step: 5,
    rawToCooked: 0.85,
    mlPerG: 1.05,
    satiety: 2.5,
    shelfDays: 14,
    packGrams: 1000,
  },
  veg: {
    label: "Vegetables",
    aisle: "Produce",
    flex: [0.5, 2.6],
    floor: 30,
    step: 10,
    rawToCooked: 0.85,
    mlPerG: 1.6,
    satiety: 3.2,
    shelfDays: 6,
    packGrams: 300,
  },
  fruit: {
    label: "Fruit",
    aisle: "Produce",
    flex: [0.6, 1.8],
    floor: 40,
    step: 5,
    rawToCooked: 1,
    mlPerG: 1.25,
    satiety: 2.4,
    shelfDays: 6,
    packGrams: 400,
  },
  legume: {
    label: "Beans & pulses",
    aisle: "Cupboard",
    flex: [0.6, 1.8],
    floor: 40,
    step: 10,
    rawToCooked: 1,
    mlPerG: 1.0,
    satiety: 2.3,
    shelfDays: 365,
    packGrams: 400,
  },
  nut_seed: {
    label: "Nuts & seeds",
    aisle: "Cupboard",
    flex: [0.7, 1.3],
    floor: 10,
    step: 5,
    rawToCooked: 1,
    mlPerG: 1.4,
    satiety: 1.2,
    shelfDays: 120,
    packGrams: 200,
  },
  fat_oil: {
    label: "Oils & fats",
    aisle: "Cupboard",
    flex: [0.75, 1.2],
    floor: 3,
    step: 1,
    rawToCooked: 1,
    mlPerG: 1.1,
    satiety: 0.15,
    shelfDays: 365,
    packGrams: 500,
  },
  sauce: {
    label: "Sauces & condiments",
    aisle: "Cupboard",
    flex: [0.7, 1.4],
    floor: 5,
    step: 5,
    rawToCooked: 1,
    mlPerG: 1.0,
    satiety: 0.8,
    shelfDays: 60,
    packGrams: 350,
  },
  supplement: {
    label: "Supplements",
    aisle: "Cupboard",
    flex: [0.5, 1.5],
    floor: 10,
    step: 5,
    rawToCooked: 1,
    mlPerG: 1.8,
    satiety: 1.6,
    shelfDays: 365,
    packGrams: 1000,
  },
  sweet: {
    label: "Sweet & snacks",
    aisle: "Cupboard",
    flex: [0.5, 1.3],
    floor: 10,
    step: 5,
    rawToCooked: 1,
    mlPerG: 1.3,
    satiety: 0.5,
    shelfDays: 90,
    packGrams: 180,
  },
  drink: {
    label: "Drinks",
    aisle: "Drinks",
    flex: [0.5, 1.8],
    floor: 50,
    step: 10,
    rawToCooked: 1,
    mlPerG: 1.0,
    satiety: 0.6,
    shelfDays: 30,
    packGrams: 1000,
  },
  other: {
    label: "Other",
    aisle: "Other",
    flex: [0.6, 1.5],
    floor: 10,
    step: 5,
    rawToCooked: 1,
    mlPerG: 1.1,
    satiety: 1.2,
    shelfDays: 14,
    packGrams: 250,
  },
};

/** A dictionary entry: what to match, and what it overrides on the class. */
type Entry = {
  /** Lower-case substrings; the longest one that matches wins. */
  match: string[];
  cls: FoodClass;
  /** Indivisible unit, e.g. one egg. */
  unitGrams?: number;
  unitName?: string;
  packGrams?: number;
  rawToCooked?: number;
  shelfDays?: number;
  aisle?: Aisle;
  mlPerG?: number;
};

/**
 * The things people actually put in a plan. Ordered loosely by aisle; the
 * matcher sorts by specificity, so "chicken thigh" beats "chicken".
 */
export const FOODS: Entry[] = [
  // ---- Meat & fish -------------------------------------------------------
  { match: ["chicken breast", "chicken fillet"], cls: "lean_protein", packGrams: 300, rawToCooked: 0.73 },
  { match: ["chicken thigh"], cls: "fatty_protein", packGrams: 400, rawToCooked: 0.72 },
  { match: ["chicken"], cls: "lean_protein", packGrams: 300 },
  { match: ["turkey mince", "turkey breast", "turkey"], cls: "lean_protein", packGrams: 500 },
  { match: ["beef mince", "minced beef"], cls: "fatty_protein", packGrams: 500, rawToCooked: 0.7 },
  { match: ["steak", "beef"], cls: "fatty_protein", packGrams: 400 },
  { match: ["pork", "gammon", "bacon"], cls: "fatty_protein", packGrams: 300 },
  { match: ["sausage"], cls: "fatty_protein", unitGrams: 57, unitName: "sausage", packGrams: 400 },
  { match: ["salmon"], cls: "oily_fish", unitGrams: 130, unitName: "fillet", packGrams: 240 },
  { match: ["mackerel", "sardine"], cls: "oily_fish", packGrams: 120 },
  { match: ["tuna"], cls: "lean_protein", unitGrams: 112, unitName: "tin", packGrams: 112, shelfDays: 365, aisle: "Cupboard" },
  { match: ["cod", "haddock", "white fish", "sea bass"], cls: "lean_protein", unitGrams: 140, unitName: "fillet", packGrams: 260 },
  { match: ["prawn", "shrimp"], cls: "lean_protein", packGrams: 200 },
  { match: ["ham", "chicken slices", "deli"], cls: "lean_protein", packGrams: 120, shelfDays: 5 },

  // ---- Dairy & eggs ------------------------------------------------------
  { match: ["egg white"], cls: "lean_protein", aisle: "Dairy & eggs", packGrams: 500, rawToCooked: 0.9 },
  { match: ["egg"], cls: "egg", unitGrams: 58, unitName: "egg", packGrams: 348 },
  { match: ["skyr"], cls: "dairy_high_protein", packGrams: 450 },
  { match: ["greek yoghurt", "greek yogurt"], cls: "dairy_high_protein", packGrams: 500 },
  { match: ["cottage cheese"], cls: "dairy_high_protein", packGrams: 300 },
  { match: ["quark"], cls: "dairy_high_protein", packGrams: 250 },
  { match: ["yoghurt", "yogurt"], cls: "dairy_high_protein", packGrams: 450 },
  { match: ["cheddar", "parmesan", "mozzarella", "cheese"], cls: "dairy_fatty", packGrams: 250 },
  { match: ["butter"], cls: "fat_oil", aisle: "Dairy & eggs", packGrams: 250 },
  { match: ["milk"], cls: "milk", packGrams: 2272 },
  { match: ["cream"], cls: "dairy_fatty", packGrams: 300, shelfDays: 7 },

  // ---- Grains & bread ----------------------------------------------------
  { match: ["oats", "porridge"], cls: "grain", packGrams: 1000, rawToCooked: 3.2 },
  { match: ["basmati", "white rice", "rice"], cls: "grain", packGrams: 1000, rawToCooked: 2.7 },
  { match: ["pasta", "spaghetti", "penne", "fusilli", "macaroni"], cls: "grain", packGrams: 500, rawToCooked: 2.4 },
  { match: ["noodle"], cls: "grain", packGrams: 300, rawToCooked: 2.4 },
  { match: ["couscous", "bulgur"], cls: "grain", packGrams: 500, rawToCooked: 2.5 },
  { match: ["quinoa"], cls: "grain", packGrams: 500, rawToCooked: 2.8 },
  { match: ["bagel"], cls: "bread", unitGrams: 85, unitName: "bagel", packGrams: 425 },
  { match: ["wrap", "tortilla"], cls: "bread", unitGrams: 62, unitName: "wrap", packGrams: 372 },
  { match: ["pitta", "pita"], cls: "bread", unitGrams: 60, unitName: "pitta", packGrams: 360 },
  { match: ["crumpet"], cls: "bread", unitGrams: 55, unitName: "crumpet", packGrams: 330 },
  { match: ["bread", "toast", "sourdough"], cls: "bread", unitGrams: 40, unitName: "slice", packGrams: 800 },
  { match: ["weetabix"], cls: "grain", unitGrams: 20, unitName: "biscuit", packGrams: 430, aisle: "Cupboard" },
  { match: ["granola", "muesli", "cereal"], cls: "grain", packGrams: 500, rawToCooked: 1 },
  { match: ["rice cake"], cls: "grain", unitGrams: 7, unitName: "cake", packGrams: 130, rawToCooked: 1 },

  // ---- Produce -----------------------------------------------------------
  { match: ["sweet potato"], cls: "starchy_veg", unitGrams: 200, unitName: "potato", packGrams: 1000 },
  { match: ["potato"], cls: "starchy_veg", unitGrams: 175, unitName: "potato", packGrams: 2000 },
  { match: ["banana"], cls: "fruit", unitGrams: 105, unitName: "banana", packGrams: 630 },
  { match: ["apple"], cls: "fruit", unitGrams: 150, unitName: "apple", packGrams: 900 },
  { match: ["orange", "satsuma", "clementine"], cls: "fruit", unitGrams: 130, unitName: "orange", packGrams: 780 },
  { match: ["blueberr", "raspberr", "strawberr", "berries"], cls: "fruit", packGrams: 300, shelfDays: 4 },
  { match: ["grape", "mango", "pineapple", "melon", "kiwi", "pear", "peach"], cls: "fruit", packGrams: 500 },
  { match: ["avocado"], cls: "fat_oil", aisle: "Produce", unitGrams: 140, unitName: "avocado", packGrams: 280, shelfDays: 5 },
  { match: ["broccoli"], cls: "veg", packGrams: 350 },
  { match: ["spinach", "kale", "rocket", "salad", "lettuce"], cls: "veg", packGrams: 250, shelfDays: 4 },
  { match: ["pepper"], cls: "veg", unitGrams: 150, unitName: "pepper", packGrams: 450 },
  { match: ["onion"], cls: "veg", unitGrams: 110, unitName: "onion", packGrams: 1000, shelfDays: 21 },
  { match: ["garlic"], cls: "veg", unitGrams: 5, unitName: "clove", packGrams: 60, shelfDays: 40 },
  { match: ["tomato"], cls: "veg", packGrams: 400 },
  { match: ["cucumber"], cls: "veg", unitGrams: 300, unitName: "cucumber", packGrams: 300 },
  { match: ["carrot"], cls: "veg", unitGrams: 70, unitName: "carrot", packGrams: 1000, shelfDays: 14 },
  { match: ["courgette", "zucchini"], cls: "veg", unitGrams: 200, unitName: "courgette", packGrams: 400 },
  { match: ["mushroom"], cls: "veg", packGrams: 250 },
  { match: ["green bean", "asparagus", "cauliflower", "cabbage", "leek", "celery"], cls: "veg", packGrams: 300 },
  { match: ["peas", "sweetcorn"], cls: "veg", packGrams: 1000, aisle: "Frozen", shelfDays: 180 },

  // ---- Cupboard ----------------------------------------------------------
  { match: ["baked beans"], cls: "legume", packGrams: 415 },
  { match: ["black bean", "kidney bean", "chickpea", "lentil", "butter bean"], cls: "legume", packGrams: 400 },
  { match: ["tofu"], cls: "lean_protein", aisle: "Cupboard", packGrams: 280, shelfDays: 14 },
  { match: ["peanut butter", "almond butter", "nut butter"], cls: "nut_seed", packGrams: 340 },
  { match: ["almond", "cashew", "walnut", "peanut", "pistachio", "nuts"], cls: "nut_seed", packGrams: 200 },
  { match: ["chia", "flaxseed", "linseed", "sunflower seed", "pumpkin seed"], cls: "nut_seed", packGrams: 250 },
  { match: ["olive oil", "rapeseed oil", "oil", "ghee", "lard"], cls: "fat_oil", packGrams: 500 },
  { match: ["whey", "protein powder", "casein", "isolate"], cls: "supplement", unitGrams: 30, unitName: "scoop", packGrams: 1000 },
  { match: ["creatine"], cls: "supplement", unitGrams: 5, unitName: "scoop", packGrams: 300 },
  { match: ["protein bar", "flapjack"], cls: "sweet", unitGrams: 60, unitName: "bar", packGrams: 720 },
  { match: ["honey", "maple syrup", "jam", "sugar"], cls: "sweet", packGrams: 340 },
  { match: ["chocolate", "biscuit", "cookie", "crisps", "haribo", "sweets"], cls: "sweet", packGrams: 180 },
  { match: ["ketchup", "mayo", "mayonnaise", "soy sauce", "sriracha", "hot sauce", "bbq sauce", "sauce"], cls: "sauce", packGrams: 350 },
  { match: ["hummus", "houmous"], cls: "sauce", packGrams: 200, shelfDays: 5 },
  { match: ["passata", "chopped tomatoes", "tomato puree"], cls: "sauce", packGrams: 400 },
  { match: ["stock", "seasoning", "spice", "salt", "pepper corn", "herbs"], cls: "other", packGrams: 100, shelfDays: 365 },

  // ---- Drinks ------------------------------------------------------------
  { match: ["orange juice", "apple juice", "juice"], cls: "drink", packGrams: 1000, shelfDays: 7 },
  { match: ["squash", "cordial", "energy drink", "lucozade", "gatorade"], cls: "drink", packGrams: 1000 },
  { match: ["coffee", "tea"], cls: "drink", packGrams: 200, shelfDays: 365 },
];

export type FoodProfile = {
  cls: FoodClass;
  spec: ClassSpec;
  aisle: Aisle;
  unitGrams: number | null;
  unitName: string | null;
  packGrams: number;
  rawToCooked: number;
  shelfDays: number;
  mlPerG: number;
  /** How confident the match was — dictionary hit vs density guess. */
  source: "dictionary" | "density";
};

const PUNCT = /[^a-z0-9\s]/g;

export function normaliseName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Aggregation key for the shopping list: "Chicken breast" and "chicken
 * breasts" are the same line on the list.
 */
export function shoppingKey(name: string): string {
  const n = normaliseName(name);
  return n
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

type Density = { kcal_100: number; protein_100: number; carbs_100: number; fat_100: number };

/** Last resort: infer a class from the macro profile alone. */
function fromDensity(d: Density): FoodClass {
  const kcal = Number(d.kcal_100) || 0;
  const p = Number(d.protein_100) || 0;
  const c = Number(d.carbs_100) || 0;
  const f = Number(d.fat_100) || 0;
  const fatCal = f * 9;

  if (kcal >= 700 && fatCal / Math.max(kcal, 1) > 0.85) return "fat_oil";
  if (kcal >= 480 && f >= 35) return "nut_seed";
  if (p >= 18 && f <= 6) return "lean_protein";
  if (p >= 15 && f > 6) return "fatty_protein";
  if (p >= 8 && c >= 3 && kcal <= 140) return "dairy_high_protein";
  if (c >= 55) return "grain";
  if (c >= 20 && kcal >= 200) return "sweet";
  if (kcal <= 45 && c <= 12) return "veg";
  if (kcal <= 90 && c >= 8) return "fruit";
  if (kcal <= 30) return "drink";
  return "other";
}

/**
 * What do we know about this ingredient? Name first, macros as the fallback.
 */
export function profileFor(name: string, macros?: Density): FoodProfile {
  const n = normaliseName(name);

  let best: Entry | null = null;
  let bestLen = 0;
  for (const e of FOODS) {
    for (const m of e.match) {
      if (n.includes(m) && m.length > bestLen) {
        best = e;
        bestLen = m.length;
      }
    }
  }

  const cls: FoodClass = best ? best.cls : macros ? fromDensity(macros) : "other";
  const spec = CLASSES[cls];

  return {
    cls,
    spec,
    aisle: best?.aisle ?? spec.aisle,
    unitGrams: best?.unitGrams ?? null,
    unitName: best?.unitName ?? null,
    packGrams: best?.packGrams ?? spec.packGrams,
    rawToCooked: best?.rawToCooked ?? spec.rawToCooked,
    shelfDays: best?.shelfDays ?? spec.shelfDays,
    mlPerG: best?.mlPerG ?? spec.mlPerG,
    source: best ? "dictionary" : "density",
  };
}

/**
 * The portion band this ingredient should get if the user hasn't set one.
 *
 * Two ideas on top of the class band:
 *  - a *dense* food gets a tighter band than the class default, because a
 *    given gram swing matters more (5 g of oil is 45 kcal; 5 g of courgette
 *    is 1 kcal),
 *  - unit foods snap to whole units, so the band is widened just enough to
 *    contain at least one step in each direction.
 */
export function smartBounds(
  name: string,
  grams: number,
  macros?: Density
): { min: number; max: number; unit: number | null; profile: FoodProfile } {
  const p = profileFor(name, macros);
  const g = Math.max(0, Number(grams) || 0);
  const kcal100 = Number(macros?.kcal_100) || 0;

  let [lo, hi] = p.spec.flex;

  // Energy density tightens the band: at 800 kcal/100g we keep ~40% of the
  // class's freedom, at 100 kcal/100g we keep all of it.
  if (kcal100 > 150) {
    const tighten = Math.min(0.6, (kcal100 - 150) / 1100);
    lo = 1 - (1 - lo) * (1 - tighten);
    hi = 1 + (hi - 1) * (1 - tighten);
  }

  let min = Math.max(p.spec.floor, g * lo);
  let max = Math.max(min + p.spec.step, g * hi);

  if (p.unitGrams) {
    // Whole units only — make sure one unit up and one down are reachable.
    const units = Math.max(1, Math.round(g / p.unitGrams));
    min = Math.max(p.unitGrams, (units - 1) * p.unitGrams);
    max = (units + 1) * p.unitGrams;
    if (g === 0) {
      min = p.unitGrams;
      max = p.unitGrams * 2;
    }
  } else {
    min = roundTo(min, p.spec.step);
    max = roundTo(max, p.spec.step);
  }

  return { min, max, unit: p.unitGrams, profile: p };
}

export function roundTo(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.round(v / step) * step;
}

export function ceilTo(v: number, step: number): number {
  if (step <= 0) return v;
  return Math.ceil(v / step) * step;
}

/**
 * Filler foods — high volume, low calorie, cheap. Offered when the plan has
 * calories left but not much actual food in it.
 */
export const VOLUME_FOODS: Array<Density & { name: string }> = [
  { name: "Broccoli", kcal_100: 34, protein_100: 2.8, carbs_100: 4.0, fat_100: 0.4 },
  { name: "Courgette", kcal_100: 17, protein_100: 1.2, carbs_100: 2.0, fat_100: 0.3 },
  { name: "Cucumber", kcal_100: 15, protein_100: 0.7, carbs_100: 3.0, fat_100: 0.1 },
  { name: "Spinach", kcal_100: 23, protein_100: 2.9, carbs_100: 1.4, fat_100: 0.4 },
  { name: "Green beans", kcal_100: 31, protein_100: 1.8, carbs_100: 4.5, fat_100: 0.1 },
  { name: "Mushrooms", kcal_100: 22, protein_100: 3.1, carbs_100: 1.0, fat_100: 0.3 },
  { name: "Cauliflower", kcal_100: 25, protein_100: 1.9, carbs_100: 3.0, fat_100: 0.3 },
  { name: "Cherry tomatoes", kcal_100: 18, protein_100: 0.9, carbs_100: 3.0, fat_100: 0.2 },
  { name: "Carrot", kcal_100: 41, protein_100: 0.9, carbs_100: 8.0, fat_100: 0.2 },
  { name: "Strawberries", kcal_100: 32, protein_100: 0.7, carbs_100: 6.0, fat_100: 0.3 },
  { name: "0% Greek yoghurt", kcal_100: 57, protein_100: 10, carbs_100: 4.0, fat_100: 0.2 },
  { name: "Egg whites", kcal_100: 52, protein_100: 11, carbs_100: 0.7, fat_100: 0.2 },
];
