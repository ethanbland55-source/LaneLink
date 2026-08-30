/**
 * Where the numbers come from.
 *
 * Every constant in this app that could have been guessed is instead pinned to
 * a paper, and this is the register of them. It exists so the app can answer
 * "why that number?" on screen rather than in a README nobody opens, and so
 * that changing a constant means changing the citation with it.
 *
 * Two rules it holds itself to:
 *
 *  - **Grades are honest.** A supplement with one good trial behind it does not
 *    get the same badge as creatine. Most of the value in a list like this is
 *    in what it refuses to endorse.
 *  - **Population figures are labelled as such.** Every recommendation here is
 *    fitted to a group of people who are not you. They are the right place to
 *    start and the wrong place to finish — which is what the calibration on the
 *    Progress page is for, and why it wins once it has three weeks of data.
 */

export type Grade = "strong" | "moderate" | "limited" | "insufficient";

export const GRADE_LABEL: Record<Grade, string> = {
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  limited: "Limited evidence",
  insufficient: "Not shown to help",
};

/** Badge-length. The full phrase and the blurb carry the meaning on hover. */
export const GRADE_SHORT: Record<Grade, string> = {
  strong: "Strong",
  moderate: "Moderate",
  limited: "Limited",
  insufficient: "No evidence",
};

export const GRADE_BLURB: Record<Grade, string> = {
  strong: "Repeatedly shown to work in trials on trained athletes.",
  moderate: "Works in the right circumstances — usually correcting a shortfall.",
  limited: "Mixed or thin evidence. Might help; hasn't been shown to reliably.",
  insufficient: "No good evidence of a performance effect. Taken for other reasons, if at all.",
};

export const GRADE_COLOUR: Record<Grade, string> = {
  strong: "var(--color-accent)",
  moderate: "var(--color-protein)",
  limited: "var(--color-carbs)",
  insufficient: "var(--color-mut)",
};

export type Citation = {
  key: string;
  authors: string;
  year: number;
  title: string;
  source: string;
  /** What this app uses it for, in one line. */
  supports: string;
};

/**
 * Position stands and consensus statements are preferred over single trials
 * throughout: they are a field's considered summary rather than one result,
 * and they are what a sports dietitian would actually work from.
 */
export const CITATIONS: Record<string, Citation> = {
  thomas2016: {
    key: "thomas2016",
    authors: "Thomas DT, Erdman KA, Burke LM",
    year: 2016,
    title:
      "Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance",
    source: "Med Sci Sports Exerc 48(3):543–568",
    supports: "The overall framework: energy availability, carbohydrate and protein ranges.",
  },
  burke2011: {
    key: "burke2011",
    authors: "Burke LM, Hawley JA, Wong SHS, Jeukendrup AE",
    year: 2011,
    title: "Carbohydrates for training and competition",
    source: "J Sports Sci 29(sup1):S17–S27",
    supports: "Carbohydrate in g/kg/day, banded by how much training the day actually holds.",
  },
  shaw2014: {
    key: "shaw2014",
    authors: "Shaw G, Boyd KT, Burke LM, Koivisto A",
    year: 2014,
    title: "Nutrition for swimming",
    source: "Int J Sport Nutr Exerc Metab 24(4):360–372",
    supports:
      "Swimming specifics: session-to-session fuelling, and why pool volume drives carbohydrate more than anything else does.",
  },
  impey2018: {
    key: "impey2018",
    authors: "Impey SG, Hearris MA, Hammond KM, et al.",
    year: 2018,
    title:
      "Fuel for the Work Required: A Theoretical Framework for Carbohydrate Periodization and the Glycogen Threshold Hypothesis",
    source: "Sports Med 48:1031–1048",
    supports: "Matching carbohydrate to the day in front of you rather than eating a flat figure.",
  },
  jager2017: {
    key: "jager2017",
    authors: "Jäger R, Kerksick CM, Campbell BI, et al.",
    year: 2017,
    title: "International Society of Sports Nutrition Position Stand: protein and exercise",
    source: "J Int Soc Sports Nutr 14:20",
    supports: "Daily protein of 1.4–2.0 g/kg, and spreading it across the day.",
  },
  morton2018: {
    key: "morton2018",
    authors: "Morton RW, Murphy KT, McKellar SR, et al.",
    year: 2018,
    title:
      "A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength",
    source: "Br J Sports Med 52:376–384",
    supports:
      "Total daily protein stops adding anything much past roughly 1.6 g/kg of bodyweight.",
  },
  areta2013: {
    key: "areta2013",
    authors: "Areta JL, Burke LM, Ross ML, et al.",
    year: 2013,
    title:
      "Timing and distribution of protein ingestion during prolonged recovery from resistance exercise alters myofibrillar protein synthesis",
    source: "J Physiol 591(9):2319–2331",
    supports:
      "Four moderate doses every three hours beat the same protein in two large ones or eight small ones.",
  },
  helms2014: {
    key: "helms2014",
    authors: "Helms ER, Aragon AA, Fitschen PJ",
    year: 2014,
    title:
      "Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation",
    source: "J Int Soc Sports Nutr 11:20",
    supports: "Protein by lean mass while in a deficit, and the fat floor underneath it.",
  },
  barakat2020: {
    key: "barakat2020",
    authors: "Barakat C, Pearson J, Escalante G, Campbell B, De Souza EO",
    year: 2020,
    title: "Body Recomposition: Can Trained Individuals Build Muscle and Lose Fat at the Same Time?",
    source: "Strength Cond J 42(5):7–21",
    supports: "That a small deficit with high protein is the shape of a recomposition.",
  },
  iraki2019: {
    key: "iraki2019",
    authors: "Iraki J, Fitschen P, Espinar S, Helms E",
    year: 2019,
    title: "Nutrition Recommendations for Bodybuilders in the Off-Season: A Narrative Review",
    source: "Sports 7(7):154",
    supports: "Modest surpluses and deficits, and fat kept above roughly 0.5 g/kg.",
  },
  maughan2018: {
    key: "maughan2018",
    authors: "Maughan RJ, Burke LM, Dvorak J, et al.",
    year: 2018,
    title: "IOC consensus statement: dietary supplements and the high-performance athlete",
    source: "Br J Sports Med 52:439–455",
    supports: "Which supplements have evidence behind them, and which are sold on hope.",
  },
  peeling2018: {
    key: "peeling2018",
    authors: "Peeling P, Binnie MJ, Goods PSR, Sim M, Burke LM",
    year: 2018,
    title: "Evidence-Based Supplements for the Enhancement of Athletic Performance",
    source: "Int J Sport Nutr Exerc Metab 28(2):178–187",
    supports: "The short list of supplements that actually move performance.",
  },
  kreider2017: {
    key: "kreider2017",
    authors: "Kreider RB, Kalman DS, Antonio J, et al.",
    year: 2017,
    title:
      "International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine",
    source: "J Int Soc Sports Nutr 14:18",
    supports: "Creatine dose, loading, and that it is safe long-term in healthy people.",
  },
  owens2018: {
    key: "owens2018",
    authors: "Owens DJ, Allison R, Close GL",
    year: 2018,
    title: "Vitamin D and the Athlete: Current Perspectives and New Challenges",
    source: "Sports Med 48(Suppl 1):3–16",
    supports:
      "Why indoor athletes run low on vitamin D, and that correcting a shortfall helps where topping up a normal level does not.",
  },
  mifflin1990: {
    key: "mifflin1990",
    authors: "Mifflin MD, St Jeor ST, Hill LA, et al.",
    year: 1990,
    title: "A new predictive equation for resting energy expenditure in healthy individuals",
    source: "Am J Clin Nutr 51(2):241–247",
    supports: "Resting metabolic rate when body fat isn't known.",
  },
  ainsworth2011: {
    key: "ainsworth2011",
    authors: "Ainsworth BE, Haskell WL, Herrmann SD, et al.",
    year: 2011,
    title: "2011 Compendium of Physical Activities: a second update of codes and MET values",
    source: "Med Sci Sports Exerc 43(8):1575–1581",
    supports: "What a session costs, by activity and intensity.",
  },
  jackson1978: {
    key: "jackson1978",
    authors: "Jackson AS, Pollock ML",
    year: 1978,
    title: "Generalized equations for predicting body density of men",
    source: "Br J Nutr 40(3):497–504",
    supports: "Body density from three skinfolds.",
  },
  siri1961: {
    key: "siri1961",
    authors: "Siri WE",
    year: 1961,
    title: "Body composition from fluid spaces and density: analysis of methods",
    source: "Techniques for Measuring Body Composition, National Academy of Sciences",
    supports: "Turning body density into a fat percentage.",
  },
  hodgdon1984: {
    key: "hodgdon1984",
    authors: "Hodgdon JA, Beckett MB",
    year: 1984,
    title:
      "Prediction of percent body fat for U.S. Navy men and women from body circumferences and height",
    source: "Naval Health Research Center, Reports 84-11 and 84-29",
    supports: "Body fat from a tape measure.",
  },
};

export function cite(key: string): Citation | null {
  return CITATIONS[key] ?? null;
}

/** "Burke et al. (2011)" — how a citation reads inline. */
export function short(key: string): string {
  const c = CITATIONS[key];
  if (!c) return "";
  const first = c.authors.split(",")[0]?.trim() ?? c.authors;
  const surname = first.split(" ")[0];
  return `${surname}${c.authors.includes(",") ? " et al." : ""} (${c.year})`;
}

/* ------------------------------------------------------------------ */
/* Carbohydrate, which is the one that matters for a swimmer            */
/* ------------------------------------------------------------------ */

export type CarbBand = {
  label: string;
  /** Grams per kg of bodyweight per day. */
  low: number;
  high: number;
  why: string;
  refs: string[];
};

/**
 * How much carbohydrate a day's training actually asks for.
 *
 * Burke's bands, which the ACSM/AND/DC position stand carries forward: the
 * figure is driven by how much work the day holds, not by a percentage of
 * calories. That distinction matters more in swimming than in most sports —
 * two hours in a pool is a large glycogen cost that a percentage-of-calories
 * split will systematically under-fill on a day you also ate less.
 *
 * Banded by daily training minutes because that is what the app knows from
 * your sessions. Intensity is folded in via MET-weighted minutes rather than
 * clock minutes, so an hour of technique work doesn't count like an hour of
 * main set.
 */
export const CARB_BANDS: CarbBand[] = [
  {
    label: "Light",
    low: 3,
    high: 5,
    why: "Little or no training — skill work, a walk, a rest day.",
    refs: ["burke2011", "thomas2016"],
  },
  {
    label: "Moderate",
    low: 5,
    high: 7,
    why: "About an hour a day of real work.",
    refs: ["burke2011", "thomas2016"],
  },
  {
    label: "High",
    low: 6,
    high: 10,
    why: "One to three hours of moderate-to-hard training — a normal pool day.",
    refs: ["burke2011", "shaw2014"],
  },
  {
    label: "Very high",
    low: 8,
    high: 12,
    why: "Four hours or more, or two hard sessions in a day.",
    refs: ["burke2011", "shaw2014"],
  },
];

/**
 * Which band a day falls in.
 *
 * `load` is MET-weighted training minutes: minutes × (MET − 1) / 6, so an hour
 * at 7 METs counts as an hour and an hour of easy technique counts as rather
 * less. The thresholds are the position stand's own hours-per-day boundaries
 * expressed in that currency — roughly 1 h, 1–3 h and 4 h+ of real work.
 *
 * Deliberately not eager at the top. Two hard pool sessions is a big day, but
 * it is not the four-to-five hours the "very high" band was written for, and
 * putting it there would ask for 12 g/kg on the strength of an arithmetic
 * flourish.
 */
export function carbBandFor(loadMinutes: number): CarbBand {
  if (loadMinutes < 45) return CARB_BANDS[0];
  if (loadMinutes < 105) return CARB_BANDS[1];
  if (loadMinutes < 240) return CARB_BANDS[2];
  return CARB_BANDS[3];
}
