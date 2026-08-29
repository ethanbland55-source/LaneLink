/**
 * What you actually did that day.
 *
 * A day type is a list of sessions, and a session is an activity at an
 * intensity for a number of minutes. That's enough to work out what the day
 * cost you, and it's a far better estimate than picking one "activity level"
 * for the whole week and then nudging it with percentages.
 *
 * MET values are from the Compendium of Physical Activities (Ainsworth et al.),
 * which is the same source most calculators quietly use. They're population
 * averages, not measurements of you — treat the resulting number as a starting
 * point and adjust it once you've watched your weight for three or four weeks.
 */

export type Level = { id: string; label: string; met: number };

export type ActivityDef = {
  id: string;
  label: string;
  /** Rough default length, so adding a session doesn't start at zero. */
  defaultMinutes: number;
  levels: Level[];
};

export const ACTIVITIES: ActivityDef[] = [
  {
    id: "swim",
    label: "Swim",
    defaultMinutes: 90,
    levels: [
      { id: "easy", label: "Technique / recovery", met: 5.8 },
      { id: "moderate", label: "Main set", met: 8.3 },
      { id: "hard", label: "Race pace / sprints", met: 9.8 },
    ],
  },
  {
    id: "gym",
    label: "Gym / weights",
    defaultMinutes: 60,
    levels: [
      { id: "easy", label: "Light / mobility", met: 3.0 },
      { id: "moderate", label: "Normal session", met: 5.0 },
      { id: "hard", label: "Heavy compound", met: 6.0 },
    ],
  },
  {
    id: "run",
    label: "Run",
    defaultMinutes: 40,
    levels: [
      { id: "easy", label: "Easy", met: 7.0 },
      { id: "moderate", label: "Steady", met: 9.8 },
      { id: "hard", label: "Intervals", met: 11.8 },
    ],
  },
  {
    id: "cycle",
    label: "Cycle",
    defaultMinutes: 60,
    levels: [
      { id: "easy", label: "Easy", met: 4.8 },
      { id: "moderate", label: "Steady", met: 7.5 },
      { id: "hard", label: "Hard", met: 10.0 },
    ],
  },
  {
    id: "sport",
    label: "Team sport",
    defaultMinutes: 60,
    levels: [
      { id: "easy", label: "Casual", met: 4.5 },
      { id: "moderate", label: "Training", met: 7.0 },
      { id: "hard", label: "Match", met: 8.5 },
    ],
  },
  {
    id: "walk",
    label: "Walk",
    defaultMinutes: 45,
    levels: [
      { id: "easy", label: "Strolling", met: 2.8 },
      { id: "moderate", label: "Brisk", met: 4.3 },
      { id: "hard", label: "Hills / pack", met: 6.0 },
    ],
  },
  {
    id: "other",
    label: "Something else",
    defaultMinutes: 45,
    levels: [
      { id: "easy", label: "Easy", met: 3.0 },
      { id: "moderate", label: "Moderate", met: 6.0 },
      { id: "hard", label: "Hard", met: 9.0 },
    ],
  },
];

export type Session = {
  /** Activity id, or any string if you've typed your own. */
  activity: string;
  level: string;
  /** Stored on the session so editing the library later can't rewrite history. */
  met: number;
  minutes: number;
};

export function activityDef(id: string): ActivityDef {
  return ACTIVITIES.find((a) => a.id === id) ?? ACTIVITIES[ACTIVITIES.length - 1];
}

export function activityLabel(s: Session): string {
  const a = ACTIVITIES.find((x) => x.id === s.activity);
  if (!a) return s.activity || "Session";
  const l = a.levels.find((x) => x.id === s.level);
  return l ? `${a.label} — ${l.label.toLowerCase()}` : a.label;
}

export function newSession(activityId: string): Session {
  const a = activityDef(activityId);
  const mid = a.levels[Math.min(1, a.levels.length - 1)];
  return { activity: a.id, level: mid.id, met: mid.met, minutes: a.defaultMinutes };
}

/**
 * Energy cost of a session, **net of resting metabolism**.
 *
 * The standard MET formula (`MET × 3.5 × kg / 200` kcal/min) is a gross figure:
 * it includes the calories you'd have burned lying on the sofa for that hour.
 * Your daily baseline already counts those, so adding the gross number
 * double-counts roughly one MET for the length of every session — about
 * 90 kcal across a two-hour training day. Subtracting the 1 MET you'd have
 * spent anyway is the honest number.
 */
export function sessionKcal(weightKg: number, s: Session): number {
  const met = Math.max(1, Number(s.met) || 1);
  const minutes = Math.max(0, Number(s.minutes) || 0);
  return ((met - 1) * 3.5 * weightKg * minutes) / 200;
}

export function sessionsKcal(weightKg: number, sessions: Session[]): number {
  return (sessions ?? []).reduce((a, s) => a + sessionKcal(weightKg, s), 0);
}

export function normaliseSession(raw: any): Session | null {
  const activity = String(raw?.activity ?? "").trim();
  if (!activity) return null;
  const minutes = Number(raw?.minutes);
  const met = Number(raw?.met);
  const def = ACTIVITIES.find((a) => a.id === activity);
  const level = String(raw?.level ?? "moderate");
  const fallbackMet = def?.levels.find((l) => l.id === level)?.met ?? 6;
  return {
    activity,
    level,
    met: Number.isFinite(met) && met >= 1 && met <= 25 ? met : fallbackMet,
    minutes: Number.isFinite(minutes) ? Math.min(600, Math.max(0, minutes)) : 0,
  };
}

export function normaliseSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normaliseSession).filter((s): s is Session => s !== null).slice(0, 6);
}

/**
 * Baseline multiplier on BMR for everything that *isn't* a logged session —
 * walking around, lectures, standing in a kitchen. Deliberately much lower
 * than the classic "activity level" multipliers, because training is now
 * counted separately instead of being baked in.
 */
export const BASE_ACTIVITY_LEVELS = [
  { value: 1.15, label: "Mostly sitting", hint: "desk, car, not much walking" },
  { value: 1.25, label: "Normal", hint: "some walking, a few stairs" },
  { value: 1.35, label: "On your feet", hint: "campus, shifts, lots of walking" },
  { value: 1.5, label: "Physically active job", hint: "manual work all day" },
];
