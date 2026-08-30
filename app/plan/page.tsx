"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RecalculateDialog } from "../recalculate";
import { Bar, MACRO_COLOR, MACRO_LABEL, Segmented, Stat, type MacroKey } from "../macro-ui";
import { offTarget, type BoundedItem } from "@/lib/optimise";
import { appliesOn, mealGroups, weekStanding, weeklyAverage, type PlanMeal } from "@/lib/weekfit";
import { dayVolume, volumeHeadline } from "@/lib/prep";
import { profileFor } from "@/lib/foods";
import { proteinDistribution } from "@/lib/protein";
import {
  ACTIVITIES,
  BASE_ACTIVITY_LEVELS,
  activityDef,
  newSession,
  sessionKcal,
  type Session,
} from "@/lib/activities";
import {
  ACTIVITY_LEVELS,
  GOALS,
  WEEKDAYS,
  WEEKDAY_LABEL,
  ageFromDob,
  buildWeekPlan,
  dayKey,
  estimatedBodyFat,
  goalDef,
  leanMass,
  proteinIsAssumed,
  proteinTarget,
  itemMacros,
  macroConsistency,
  normaliseDayType,
  sumMacros,
  ZERO_MACROS,
  targetsFor,
  totalFor,
  type DayType,
  type Goal,
  type Profile,
  type ProteinBasis,
  type Weekday,
} from "@/lib/nutrition";
import { DOW_LABELS, SHOP_DAY_OPTIONS, normaliseProfile } from "@/lib/profile";

type Meal = {
  id: number;
  name: string;
  times_per_day: number;
  day_type_ids: number[] | null;
  /** Cooked ahead in one go and served by weight. */
  batch: boolean;
  /** Share of its group's calories, where meals appear on the same days. */
  share_pct: number | null;
  ingredients: BoundedItem[];
};

const BLANK: BoundedItem = {
  name: "",
  grams: 100,
  kcal_100: 0,
  protein_100: 0,
  carbs_100: 0,
  fat_100: 0,
  min_grams: null,
  max_grams: null,
  locked: false,
  share_pct: null,
};

const BAR_KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

export default function PlanPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [dayTypes, setDayTypes] = useState<DayType[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecalc, setShowRecalc] = useState(false);
  const [planFor, setPlanFor] = useState<number>(0);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, m, dt] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
        fetch("/api/day-types").then((r) => r.json()),
      ]);
      setProfile(normaliseProfile(p));
      setMeals(
        (m as any[]).map((x) => ({
          ...x,
          times_per_day: Number(x.times_per_day ?? 1),
          day_type_ids: x.day_type_ids ?? null,
          batch: !!x.batch,
          share_pct: x.share_pct ?? null,
        }))
      );
      setDayTypes((dt as any[]).map((x, i) => normaliseDayType(x, i)));
      setLoading(false);
    })();
  }, []);

  const plan = useMemo(
    () => (profile ? buildWeekPlan(profile, dayTypes) : null),
    [profile, dayTypes]
  );

  // Default to whichever day type the week uses most — usually the one you
  // want to be looking at.
  useEffect(() => {
    if (!plan || planFor) return;
    const counts = new Map<number, number>();
    for (const d of WEEKDAYS) counts.set(plan.week[d], (counts.get(plan.week[d]) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    setPlanFor(best ? best[0] : plan.order[0] ?? 0);
  }, [plan, planFor]);

  const target = useMemo(() => (plan ? targetsFor(plan, planFor) : null), [plan, planFor]);

  const activeMeals = useMemo(
    () =>
      meals.filter((m) => !profile?.cycling || appliesOn(m, planFor, dayTypes.length)),
    [meals, profile, planFor, dayTypes.length]
  );

  const planTotal = useMemo(
    () =>
      sumMacros(
        activeMeals.flatMap((m) =>
          Array.from({ length: Math.max(1, Math.round(m.times_per_day || 1)) }, () =>
            totalFor(m.ingredients)
          )
        )
      ),
    [activeMeals]
  );

  const drift = useMemo(() => (target ? offTarget(planTotal, target) : null), [planTotal, target]);

  /**
   * The whole week, not one day of it. Portions are shared across every kind of
   * day, so a plan that lands a rest day perfectly and runs 300 kcal over on
   * three swim days is not a plan that works — and looking at one day type at a
   * time is exactly how that goes unnoticed.
   */
  const standing = useMemo(
    () => (plan ? weekStanding(meals, plan) : []),
    [meals, plan]
  );
  const weekAvg = useMemo(
    () => (plan ? weeklyAverage(meals, plan) : { planned: ZERO_MACROS, target: ZERO_MACROS }),
    [meals, plan]
  );
  const unusedTypes = standing.filter((d) => d.days === 0);

  /** Meals that share their days with another meal — the only ones a share means anything for. */
  const shareGroups = useMemo(() => {
    const out = new Map<number, boolean>();
    for (const g of mealGroups(meals, dayTypes.length)) {
      if (g.meals.length < 2) continue;
      for (const m of g.meals) out.set(m.id, true);
    }
    return out;
  }, [meals, dayTypes.length]);
  const weekDiff = Math.round(weekAvg.planned.kcal - weekAvg.target.kcal);
  const weekOff = Math.abs(weekDiff) > Math.max(20, weekAvg.target.kcal * 0.01);

  /**
   * The goal says protein should be scaled by lean mass and the profile says
   * bodyweight. That is not a preference, it is a profile written before the
   * goal knew the difference — and it inflates the target by about 15% while
   * looking completely normal in the box.
   */
  const basisMismatch =
    !!profile &&
    goalDef(profile.goal).protein.basis === "lean" &&
    profile.protein_basis === "bodyweight";
  const volume = useMemo(() => dayVolume(activeMeals), [activeMeals]);
  const protein = useMemo(
    () => (profile ? proteinDistribution(activeMeals, profile.weight_kg) : null),
    [activeMeals, profile]
  );

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setProfile((p) => (p ? { ...p, [k]: v } : p));
  }

  /**
   * Choosing a goal sets the whole shape of the block, not just a percentage:
   * where it starts, where it ends, and how protein and fat are worked out.
   * All of it stays editable underneath.
   */
  function pickGoal(g: Goal) {
    const d = goalDef(g);
    setProfile((p) =>
      p
        ? {
            ...p,
            goal: g,
            phase_start_adjust: d.start,
            phase_end_adjust: d.end,
            protein_basis: d.protein.basis,
            protein_per_kg: d.protein.perKg,
            fat_per_kg: d.fatPerKg,
            phase_name: p.phase_name || d.label,
            // A drifting goal is meaningless without a block to drift across.
            phase_start: d.start !== d.end ? p.phase_start ?? dayKey() : p.phase_start,
            phase_weeks: d.start !== d.end && !p.phase_weeks ? 10 : p.phase_weeks,
          }
        : p
    );
  }

  async function saveProfile(next?: Profile) {
    const body = next ?? profile;
    if (!body) return;
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    flash("Saved");
  }

  /* ---- day types ---- */

  function patchDayType(id: number, patch: Partial<DayType>) {
    setDayTypes((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async function saveDayType(t: DayType) {
    await fetch("/api/day-types", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(t),
    });
    flash(`${t.name} saved`);
  }

  async function addDayType() {
    const res = await fetch("/api/day-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New day type" }),
    });
    const created = normaliseDayType(await res.json(), dayTypes.length);
    setDayTypes((ts) => [...ts, created]);
  }

  async function duplicateDayType(t: DayType) {
    const res = await fetch("/api/day-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `${t.name} copy` }),
    });
    const created = normaliseDayType(await res.json(), dayTypes.length);
    const copy = { ...created, sessions: t.sessions, fixed_kcal: t.fixed_kcal };
    await fetch("/api/day-types", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(copy),
    });
    setDayTypes((ts) => [...ts, copy]);
  }

  async function deleteDayType(t: DayType) {
    if (dayTypes.length <= 1) return;
    if (!confirm(`Delete "${t.name}"? Days using it will fall back to another type.`)) return;
    const res = await fetch(`/api/day-types?id=${t.id}`, { method: "DELETE" });
    if (!res.ok) {
      flash("Couldn't delete that one");
      return;
    }
    setDayTypes((ts) => ts.filter((x) => x.id !== t.id));
    setMeals((ms) =>
      ms.map((m) => ({
        ...m,
        day_type_ids: m.day_type_ids ? m.day_type_ids.filter((i) => i !== t.id) : null,
      }))
    );
    setProfile((p) => {
      if (!p) return p;
      const fallback = dayTypes.find((x) => x.id !== t.id)?.id ?? 0;
      const week = { ...p.week };
      for (const d of WEEKDAYS) if (week[d] === t.id) week[d] = fallback;
      return { ...p, week };
    });
    if (planFor === t.id) setPlanFor(0);
  }

  /* ---- meals ---- */

  async function addMeal() {
    const res = await fetch("/api/meals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Meal ${meals.length + 1}` }),
    });
    const created = await res.json();
    setMeals((m) => [
      ...m,
      {
        ...created,
        times_per_day: 1,
        day_type_ids: null,
        batch: false,
        share_pct: null,
        ingredients: [],
      },
    ]);
  }

  async function persist(meal: Meal) {
    await fetch("/api/meals", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(meal),
    });
  }

  async function saveMeal(meal: Meal) {
    await persist(meal);
    flash("Saved");
  }

  /**
   * The rebalance covers the whole week, so it comes back with every meal —
   * portions and the splits you set while you were in there.
   */
  async function applyRecalc(next: PlanMeal[]) {
    const merged = meals.map((m) => {
      const n = next.find((x) => x.id === m.id);
      return n ? { ...m, ingredients: n.ingredients, share_pct: n.share_pct ?? null } : m;
    });
    for (const m of merged) await persist(m);
    setMeals(merged);
    setShowRecalc(false);
    flash("Week rebalanced");
  }

  async function deleteMeal(id: number) {
    if (!confirm("Delete this meal?")) return;
    await fetch(`/api/meals?id=${id}`, { method: "DELETE" });
    setMeals((m) => m.filter((x) => x.id !== id));
  }

  function patchMeal(id: number, patch: Partial<Meal>) {
    setMeals((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function patchItem(mealId: number, idx: number, patch: Partial<BoundedItem>) {
    setMeals((list) =>
      list.map((m) =>
        m.id !== mealId
          ? m
          : {
              ...m,
              ingredients: m.ingredients.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
            }
      )
    );
  }

  function flash(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2000);
  }

  if (loading || !profile || !plan || !target) {
    return <p className="py-24 text-center text-sm text-[var(--color-mut)]">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {saved && (
        <div className="num fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm text-[#10160a] shadow-2xl">
          {saved}
        </div>
      )}

      {showRecalc && (
        <RecalculateDialog
          meals={meals}
          plan={plan}
          defaultMode={profile.calorie_override != null ? "calories_exact" : "balanced"}
          onClose={() => setShowRecalc(false)}
          onApply={applyRecalc}
        />
      )}

      {/* The week — what each kind of day should be, and what it is */}
      <section className="card px-5 py-6">
        <p className="label">Your week, on average</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="num-hero text-[3.25rem] sm:text-[4rem]">
            {Math.round(weekAvg.planned.kcal).toLocaleString()}
          </p>
          <p
            className="text-lg font-bold tabular-nums"
            style={{ color: weekOff ? "var(--color-carbs)" : "var(--color-accent)" }}
          >
            {weekOff
              ? `${weekDiff >= 0 ? "+" : ""}${weekDiff} a day`
              : "on target"}
          </p>
        </div>
        <p className="mt-1 text-sm text-[var(--color-mut)]">
          against a {Math.round(weekAvg.target.kcal).toLocaleString()} kcal average
        </p>

        {/* Every kind of day, so it is obvious which one is off */}
        <div className="mt-5 space-y-1.5">
          {standing
            .filter((d) => d.days > 0)
            .map((d) => {
              const off = Math.round(d.planned.kcal - d.target.kcal);
              const ok = Math.abs(off) <= Math.max(2, d.target.kcal * 0.02);
              return (
                <div key={d.id} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className="shrink-0 text-xs text-[var(--color-mut)]">
                    {d.days === 1 ? "1 day" : `${d.days} days`}
                  </span>
                  <span className="num w-14 shrink-0 text-right text-sm text-[var(--color-mut)]">
                    {Math.round(d.target.kcal).toLocaleString()}
                  </span>
                  <span className="shrink-0 text-[#454b57]">→</span>
                  <span
                    className="num w-14 shrink-0 text-right text-sm"
                    style={{ color: ok ? "var(--color-accent)" : "var(--color-carbs)" }}
                  >
                    {Math.round(d.planned.kcal).toLocaleString()}
                  </span>
                </div>
              );
            })}
        </div>

        {unusedTypes.length > 0 && (
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
            {unusedTypes.map((d) => d.name).join(", ")}{" "}
            {unusedTypes.length === 1 ? "isn't" : "aren't"} used by any weekday, so{" "}
            {unusedTypes.length === 1 ? "it isn't" : "they aren't"} balanced against.
          </p>
        )}

        <button
          className={`${weekOff ? "btn btn-accent" : "btn"} mt-5 w-full`}
          onClick={() => setShowRecalc(true)}
          disabled={meals.every((m) => m.ingredients.length === 0)}
        >
          Rebalance the week
        </button>
      </section>

      {/* One kind of day in detail */}
      <section className="card px-5 py-5">
        <p className="label mb-2">Looking at a</p>
        <Segmented
          size="sm"
          value={planFor}
          onChange={setPlanFor}
          options={plan.dayTypes.map((d) => ({ value: d.id, label: d.name }))}
        />

        <div className="mt-5 space-y-3">
          {BAR_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-[var(--color-mut)]">
                {MACRO_LABEL[k]}
              </span>
              <Bar value={planTotal[k]} target={target[k]} color={MACRO_COLOR[k]} height={5} />
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--color-mut)]">
                <b className="text-[#f2f4f7]">{Math.round(planTotal[k])}</b> /{" "}
                {Math.round(target[k])}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-[var(--color-mut)]">
          {volumeHeadline(volume)}
        </p>
      </section>

      {/* Meals */}
      {meals.map((meal) => {
        const t = totalFor(meal.ingredients);
        const hidden = profile.cycling && !appliesOn(meal, planFor, dayTypes.length);
        return (
          <section
            key={meal.id}
            className="card px-4 py-4 sm:px-5"
            style={hidden ? { opacity: 0.5 } : undefined}
          >
            <div className="flex items-center gap-2">
              <input
                className="field mr-auto w-full max-w-[13rem] font-semibold"
                value={meal.name}
                onChange={(e) => patchMeal(meal.id, { name: e.target.value })}
              />
              <span className="num hidden text-sm text-[var(--color-mut)] sm:block">
                {Math.round(t.kcal)}
              </span>
              <button className="btn btn-sm btn-quiet" onClick={() => deleteMeal(meal.id)}>
                Delete
              </button>
              <button className="btn btn-sm btn-accent" onClick={() => saveMeal(meal)}>
                Save
              </button>
            </div>

            {/* How often, and on which days */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-[var(--color-mut)]">Times a day</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className="field w-16 px-2 py-1 text-right text-xs"
                  value={meal.times_per_day}
                  onChange={(e) =>
                    patchMeal(meal.id, { times_per_day: Number(e.target.value) || 1 })
                  }
                />
              </label>

              <button
                className={meal.batch ? "btn btn-sm btn-accent" : "btn btn-sm"}
                title="Cooked ahead in one go and served by weight, so the fit can only change the serving size"
                onClick={() => patchMeal(meal.id, { batch: !meal.batch })}
              >
                {meal.batch ? "Cooked ahead" : "Plated fresh"}
              </button>

              {profile.cycling && (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[var(--color-mut)]">On</span>
                  {plan.dayTypes.map((d) => {
                    const list = meal.day_type_ids ?? [];
                    const on = list.length === 0 || list.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        className={on ? "btn btn-sm btn-accent" : "btn btn-sm"}
                        onClick={() => {
                          const all = plan.dayTypes.map((x) => x.id);
                          const cur = list.length === 0 ? all : list;
                          const next = on ? cur.filter((v) => v !== d.id) : [...cur, d.id];
                          patchMeal(meal.id, {
                            day_type_ids:
                              next.length === 0 || next.length === all.length ? null : next,
                          });
                        }}
                      >
                        {d.name}
                      </button>
                    );
                  })}
                </span>
              )}

              {/* Only meaningful where meals share a set of days: on their own
                  they always take 100% of it, and the box would be a lie. */}
              {shareGroups.get(meal.id) && (
                <label className="flex items-center gap-2">
                  <span className="text-[var(--color-mut)]">Share of those days</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="auto"
                    className="field w-16 px-2 py-1 text-right text-xs"
                    title="How much of what this group of meals adds up to should be this one. Leave empty to let the fit decide."
                    value={meal.share_pct ?? ""}
                    onChange={(e) =>
                      patchMeal(meal.id, {
                        share_pct: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  <span className="text-[var(--color-mut)]">%</span>
                </label>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {meal.ingredients.map((it, i) => (
                <IngredientRow
                  key={i}
                  it={it}
                  advanced={advanced}
                  shareable={meal.ingredients.length > 1}
                  onPatch={(p) => patchItem(meal.id, i, p)}
                  onRemove={() =>
                    patchMeal(meal.id, {
                      ingredients: meal.ingredients.filter((_, j) => j !== i),
                    })
                  }
                />
              ))}
            </div>

            {meal.batch && meal.ingredients.length > 0 && (
              <p className="mt-2.5 text-[0.7rem] leading-relaxed text-[#5b6270]">
                One serving is {Math.round(totalGrams(meal))} g of the batch. Recalculate can
                change how much of it you plate, but not the ratio inside it — once it's cooked,
                that's fixed. The cook list on the Shop page turns this into what to cook and how
                much to serve on each kind of day.
              </p>
            )}

            <button
              className="btn btn-sm btn-quiet mt-3"
              onClick={() =>
                patchMeal(meal.id, { ingredients: [...meal.ingredients, { ...BLANK }] })
              }
            >
              + Ingredient
            </button>
          </section>
        );
      })}

      <div className="flex gap-2">
        <button className="btn flex-1" onClick={addMeal}>
          + Add meal
        </button>
        <button className="btn" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Hide limits" : "Show limits"}
        </button>
      </div>

      {/* Your week */}
      <section className="card px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="mr-auto">
            <p className="label">Your week</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
              Describe the kinds of day you have, then say which is which. Calories follow the
              training, and the seven-day average still lands on your goal.
            </p>
          </div>
          <button
            className={profile.cycling ? "btn btn-sm btn-accent" : "btn btn-sm"}
            onClick={() => set("cycling", !profile.cycling)}
          >
            {profile.cycling ? "On" : "Off"}
          </button>
        </div>

        {profile.cycling && (
          <>
            {profile.energy_model === "flat" && (
              <div className="mt-4 rounded-xl bg-[#2a2416] px-4 py-3 text-xs leading-relaxed text-[#ffd08a]">
                <p>
                  You're still on the old model — one activity multiplier, adjusted by percentages.
                  Switching to sessions works out each day from what you actually did, which is
                  more accurate and is what the day types below are for. Your targets will change.
                </p>
                <button
                  className="btn btn-sm mt-2.5"
                  onClick={() => {
                    const next: Profile = { ...profile, energy_model: "sessions" as const };
                    setProfile(next);
                    saveProfile(next);
                  }}
                >
                  Switch to session-based energy
                </button>
              </div>
            )}

            <div className="mt-4 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center">
                  <p className="mb-1 text-[0.65rem] font-semibold text-[var(--color-mut)]">
                    {WEEKDAY_LABEL[d]}
                  </p>
                  <select
                    className="field w-full px-1 py-1.5 text-center text-[0.68rem]"
                    value={plan.week[d]}
                    onChange={(e) =>
                      set("week", { ...profile.week, [d as Weekday]: Number(e.target.value) })
                    }
                  >
                    {plan.dayTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <p className="num mt-1 text-[0.65rem] text-[var(--color-mut)]">
                    {targetsFor(plan, plan.week[d]).kcal}
                  </p>
                </div>
              ))}
            </div>

            {profile.energy_model === "sessions" && (
              <label className="mt-4 block">
                <span className="label mb-1.5 block">
                  Baseline — everything that isn't a session
                </span>
                <select
                  className="field w-full"
                  value={profile.base_activity}
                  onChange={(e) => set("base_activity", Number(e.target.value))}
                >
                  {BASE_ACTIVITY_LEVELS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label} — {a.hint}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="mt-5 space-y-2">
              {plan.dayTypes.map((t) => (
                <DayTypeCard
                  key={t.id}
                  dt={t}
                  target={targetsFor(plan, t.id)}
                  weightKg={profile.weight_kg}
                  sessionsModel={profile.energy_model === "sessions"}
                  usedOn={WEEKDAYS.filter((d) => plan.week[d] === t.id).map(
                    (d) => WEEKDAY_LABEL[d]
                  )}
                  canDelete={plan.dayTypes.length > 1}
                  onPatch={(p) => patchDayType(t.id, p)}
                  onSave={() => saveDayType(dayTypes.find((x) => x.id === t.id) ?? t)}
                  onDuplicate={() => duplicateDayType(t)}
                  onDelete={() => deleteDayType(t)}
                />
              ))}
            </div>

            <button className="btn mt-3 w-full" onClick={addDayType}>
              + Add a day type
            </button>

            <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
              Baseline {plan.baseline.toLocaleString()} kcal · average day{" "}
              {plan.maintenance.toLocaleString()} kcal · aiming for{" "}
              {plan.goalKcal.toLocaleString()} kcal a day across the week.
            </p>
          </>
        )}

        <button className="btn btn-accent mt-4 w-full" onClick={() => saveProfile()}>
          Save week
        </button>
      </section>

      {/* Phase */}
      <section className="card px-5 py-5">
        <p className="label">This block</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
          A block has a start, a length, and a target that can move across it. Starting level with
          maintenance and drifting gently under is how you get leaner without the training falling
          apart — the scale barely reacts, and body composition does.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              className="field w-full"
              placeholder={goalDef(profile.goal).label}
              value={profile.phase_name}
              onChange={(e) => set("phase_name", e.target.value)}
            />
          </Field>

          <Field label="Starts">
            <input
              type="date"
              className="field w-full"
              value={profile.phase_start ?? ""}
              onChange={(e) => set("phase_start", e.target.value || null)}
            />
          </Field>

          <Field label="Length in weeks — 0 to hold the starting figure">
            <Num
              value={profile.phase_weeks}
              onChange={(v) => set("phase_weeks", Math.max(0, Math.round(v)))}
              step={1}
            />
          </Field>

          <div>
            <span className="label mb-2 block">Right now</span>
            <div className="sunk px-3 py-3">
              <p className="num text-xl" style={{ color: "var(--color-accent)" }}>
                {plan.goalKcal.toLocaleString()}
              </p>
              <p className="mt-1 text-[0.7rem] text-[var(--color-mut)]">
                {plan.phase.week != null
                  ? `week ${plan.phase.week} of ${plan.phase.weeks} · ${adjLabel(plan.phase.adjust)}`
                  : adjLabel(plan.phase.adjust)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {(
            [
              ["phase_start_adjust", "Starts at"],
              ["phase_end_adjust", "Ends at"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-[var(--color-mut)]">{label}</span>
              <input
                type="range"
                min={-30}
                max={20}
                step={1}
                value={Math.round(profile[key] * 100)}
                className="flex-1 accent-[var(--color-accent)]"
                onChange={(e) => set(key, Number(e.target.value) / 100)}
              />
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-[var(--color-mut)]">
                {adjLabel(profile[key])}
              </span>
            </div>
          ))}
        </div>

        {(() => {
          // The day where fat gets squeezed is the smallest one, because the
          // carb floor takes it from fat first. Check every day type and report
          // the worst rather than whichever one you happen to be looking at.
          const worst = plan.order
            .map((i) => targetsFor(plan, i))
            .sort((a, b) => a.fatPerKg - b.fatPerKg)[0];
          if (!worst || worst.fatPerKg >= 0.6) return null;
          return (
            <p className="mt-4 rounded-xl bg-[#2a2416] px-3.5 py-2.5 text-xs leading-relaxed text-[#ffd08a]">
              Fat drops to {worst.fatPerKg.toFixed(2)} g/kg on a {worst.name.toLowerCase()} day —
              the carb floor is taking it. Under about 0.6 g/kg for a long block isn't worth it for
              the calories it saves; raise fat g/kg, or lower the carb floor so carbs give way
              instead.
            </p>
          );
        })()}

        <button className="btn btn-accent mt-4 w-full" onClick={() => saveProfile()}>
          Save block
        </button>
      </section>

      {/* Protein distribution */}
      {protein && protein.meals.length > 0 && (
        <section className="card px-5 py-5">
          <div className="flex items-baseline">
            <p className="label mr-auto">Protein, spread across the day</p>
            <span
              className="num text-sm"
              style={{ color: protein.ok ? "var(--color-accent)" : "var(--color-carbs)" }}
            >
              {protein.clearing}/{protein.target}
            </span>
          </div>

          <div className="mt-3 space-y-1.5">
            {protein.meals.map((m, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="mr-auto min-w-0 flex-1 truncate text-sm">{m.name}</span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#23262c]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, m.doses * 100)}%`,
                      background: m.clears ? MACRO_COLOR.protein : "#3d434e",
                    }}
                  />
                </div>
                <span className="num w-12 text-right text-sm">{Math.round(m.protein)}g</span>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
            {protein.notes.join(" ")} A dose under about {Math.round(protein.thresholdG)} g doesn't
            clear the threshold that switches muscle protein synthesis on — the protein still gets
            used, the signal just isn't sent.
          </p>
        </section>
      )}

      {/* Shopping */}
      <section className="card px-5 py-5">
        <p className="label">Shopping</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
          How many days of food you buy in one go, and the day you shop.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SHOP_DAY_OPTIONS.map((n) => (
            <button
              key={n}
              className={`${profile.shop_days === n ? "btn btn-accent" : "btn"} btn-sm`}
              onClick={() => set("shop_days", n)}
            >
              {n} days
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="label mb-1.5 block">Shop day</span>
          <select
            className="field w-full max-w-[13rem]"
            value={profile.shop_start_dow}
            onChange={(e) => set("shop_start_dow", Number(e.target.value))}
          >
            {DOW_LABELS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <Link href="/shop" className="btn btn-accent mt-4 w-full">
          Open the shopping list
        </Link>
      </section>

      {/* Numbers */}
      <section className="card px-5 py-5">
        <p className="label">Your numbers</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Sex">
            <select
              className="field w-full"
              value={profile.sex}
              onChange={(e) => set("sex", e.target.value as Profile["sex"])}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>

          <Field label={`Date of birth · ${ageFromDob(profile.dob)}y`}>
            <input
              type="date"
              className="field w-full"
              value={profile.dob ?? ""}
              onChange={(e) => set("dob", e.target.value || null)}
            />
          </Field>

          <Field label="Height (cm)">
            <Num value={profile.height_cm} onChange={(v) => set("height_cm", v)} step={0.5} />
          </Field>

          <Field label="Weight (kg)">
            <Num value={profile.weight_kg} onChange={(v) => set("weight_kg", v)} step={0.1} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Body fat — optional, but it sharpens BMR and the protein target">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["none", "Don't use it"],
                    ["tape", "From a tape"],
                    ["manual", "I know it"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    className={profile.bf_source === v ? "btn btn-accent" : "btn"}
                    onClick={() => set("bf_source", v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            {profile.bf_source === "manual" && (
              <div className="mt-3">
                <Field label="Body fat %">
                  <Num
                    value={profile.body_fat_pct ?? 0}
                    onChange={(v) => set("body_fat_pct", v > 0 ? v : null)}
                    step={0.5}
                  />
                </Field>
              </div>
            )}

            {profile.bf_source === "tape" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Neck (cm) — just below the larynx, once">
                  <Num
                    value={profile.neck_cm ?? 0}
                    onChange={(v) => set("neck_cm", v > 0 ? v : null)}
                    step={0.5}
                  />
                </Field>
                {profile.sex === "female" && (
                  <Field label="Hips (cm) — widest point">
                    <Num
                      value={profile.hip_cm ?? 0}
                      onChange={(v) => set("hip_cm", v > 0 ? v : null)}
                      step={0.5}
                    />
                  </Field>
                )}
                <Field label="Waist (cm) — kept up to date from Progress">
                  <Num
                    value={profile.waist_cm ?? 0}
                    onChange={(v) => set("waist_cm", v > 0 ? v : null)}
                    step={0.5}
                  />
                </Field>
              </div>
            )}

            {(() => {
              const bf = estimatedBodyFat(profile);
              if (profile.bf_source === "none") {
                return (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                    Fine to leave off. BMR falls back to height and age, and a lean-mass protein
                    target assumes a plausible body fat rather than guessing high.
                  </p>
                );
              }
              if (!bf) {
                return (
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
                    {profile.bf_source === "tape"
                      ? "Needs a neck measurement and a waist reading. Neck is a one-off; the waist comes from the Progress page."
                      : "Enter a percentage, or switch to the tape estimate."}
                  </p>
                );
              }
              return (
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                  <b className="text-[#f2f4f7]">{bf.pct}%</b> body fat ·{" "}
                  {bf.leanKg} kg lean
                  {bf.error > 0 && (
                    <>
                      {" "}· ±{bf.error} points against a scan, so treat the number as approximate
                      and the change over time as the real signal
                    </>
                  )}
                </p>
              );
            })()}
          </div>

          {profile.energy_model === "flat" && (
            <div className="sm:col-span-2">
              <Field label="Activity — one multiplier for the whole week">
                <select
                  className="field w-full"
                  value={profile.activity}
                  onChange={(e) => set("activity", Number(e.target.value))}
                >
                  {ACTIVITY_LEVELS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label} — {a.hint}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <div className="sm:col-span-2">
            <Field label="Goal">
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => pickGoal(g.value)}
                    className={profile.goal === g.value ? "btn btn-accent" : "btn"}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                {goalDef(profile.goal).blurb}
              </p>
            </Field>
          </div>

          <Field
            label={`Protein g/kg ${profile.protein_basis === "lean" ? "lean mass" : "bodyweight"} · ${Math.round(proteinTarget(profile))} g`}
          >
            <div className="flex gap-2">
              <Num
                value={profile.protein_per_kg}
                onChange={(v) => set("protein_per_kg", v)}
                step={0.1}
              />
              <select
                className="field w-36"
                value={profile.protein_basis}
                onChange={(e) => set("protein_basis", e.target.value as ProteinBasis)}
              >
                <option value="bodyweight">of bodyweight</option>
                <option value="lean">of lean mass</option>
              </select>
            </div>
            {proteinIsAssumed(profile) && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                No body fat figure, so lean mass is assumed rather than known — the target is
                converted rather than applied to bodyweight, which would silently add about 15%.
                Set body fat above to make it exact.
              </p>
            )}

            {/* A figure meant for lean mass, applied to bodyweight, is a 15%
                bigger protein target than the goal intended — and it looks
                identical in the box. Worth saying out loud. */}
            {basisMismatch && (
              <div className="mt-2 rounded-xl bg-[#2a2416] px-3 py-2.5 text-xs leading-relaxed text-[#ffd08a]">
                <p>
                  {goalDef(profile.goal).label} means {goalDef(profile.goal).protein.perKg} g per kg
                  of <b>lean mass</b>, but this is set to per kg of bodyweight — so it&rsquo;s
                  asking for {Math.round(proteinTarget(profile))} g rather than about{" "}
                  {Math.round(
                    proteinTarget({ ...profile, protein_basis: "lean" })
                  )}{" "}
                  g.
                </p>
                <button
                  className="btn btn-sm mt-2"
                  onClick={() =>
                    setProfile((p) =>
                      p
                        ? {
                            ...p,
                            protein_basis: goalDef(p.goal).protein.basis,
                            protein_per_kg: goalDef(p.goal).protein.perKg,
                          }
                        : p
                    )
                  }
                >
                  Use lean mass, as the goal intends
                </button>
              </div>
            )}
          </Field>

          <Field label="Fat g/kg">
            <Num value={profile.fat_per_kg} onChange={(v) => set("fat_per_kg", v)} step={0.05} />
          </Field>

          <Field label="Carb floor g/kg — carbs never go below this">
            <Num
              value={profile.carb_floor_per_kg}
              onChange={(v) => set("carb_floor_per_kg", v)}
              step={0.1}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Manual kcal override — your own number, used as the weekly average">
              <input
                type="number"
                className="field w-full"
                value={profile.calorie_override ?? ""}
                placeholder={`${plan.maintenance} — calculated`}
                onChange={(e) =>
                  set("calorie_override", e.target.value ? Number(e.target.value) : null)
                }
              />
            </Field>
            {profile.calorie_override != null && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                Using your number as the seven-day average. The shape of the week still comes from
                your sessions, and Recalculate will default to landing this figure exactly.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="BMR" value={plan.bmr} sub={plan.method} />
          <Stat label="Average day" value={plan.maintenance} sub="cost of your week" />
          <Stat label="Target" value={plan.goalKcal} accent sub="7-day average" />
        </div>

        <button className="btn btn-accent mt-4 w-full" onClick={() => saveProfile()}>
          Save targets
        </button>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */

function DayTypeCard({
  dt,
  target,
  weightKg,
  sessionsModel,
  usedOn,
  canDelete,
  onPatch,
  onSave,
  onDuplicate,
  onDelete,
}: {
  dt: DayType;
  target: ReturnType<typeof targetsFor>;
  weightKg: number;
  sessionsModel: boolean;
  usedOn: string[];
  canDelete: boolean;
  onPatch: (p: Partial<DayType>) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  function patchSession(i: number, p: Partial<Session>) {
    onPatch({ sessions: dt.sessions.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  }

  return (
    <div className="sunk px-3.5 py-3">
      <div className="flex items-center gap-2">
        <input
          className="field field-bare mr-auto min-w-0 flex-1 px-1.5 py-1 text-sm font-semibold"
          value={dt.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <span className="num text-sm" style={{ color: "var(--color-accent)" }}>
          {target.kcal.toLocaleString()}
        </span>
        <button className="btn btn-sm btn-quiet" onClick={() => setOpen((o) => !o)}>
          {open ? "Done" : "Edit"}
        </button>
      </div>

      <p className="mt-1 pl-1.5 text-[0.68rem] text-[#5b6270]">
        {dt.sessions.length
          ? dt.sessions
              .map((s) => `${activityDef(s.activity).label.toLowerCase()} ${s.minutes}′`)
              .join(" + ")
          : "no sessions"}
        {usedOn.length > 0 && ` · ${usedOn.join(", ")}`}
        {sessionsModel && target.sessionKcal > 0 && ` · +${target.sessionKcal} kcal`}
        {dt.fixed_kcal != null && " · pinned"}
      </p>

      {open && (
        <div className="mt-3 space-y-2 border-t border-[#1c1f25] pt-3">
          {dt.sessions.map((s, i) => {
            const def = activityDef(s.activity);
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <select
                  className="field px-2 py-1 text-xs"
                  value={s.activity}
                  onChange={(e) => {
                    const next = newSession(e.target.value);
                    patchSession(i, { ...next, minutes: s.minutes });
                  }}
                >
                  {ACTIVITIES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <select
                  className="field px-2 py-1 text-xs"
                  value={s.level}
                  onChange={(e) => {
                    const lvl = def.levels.find((l) => l.id === e.target.value);
                    patchSession(i, { level: e.target.value, met: lvl?.met ?? s.met });
                  }}
                >
                  {def.levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  step={5}
                  className="field w-[4.2rem] px-2 py-1 text-right text-xs"
                  value={s.minutes}
                  onChange={(e) => patchSession(i, { minutes: Number(e.target.value) || 0 })}
                />
                <span className="text-xs text-[var(--color-mut)]">min</span>
                <span className="num text-xs text-[#5b6270]">
                  {Math.round(sessionKcal(weightKg, s))} kcal
                </span>
                <button
                  className="ml-auto px-1 text-[#4a505c] transition hover:text-[var(--color-fat)]"
                  onClick={() => onPatch({ sessions: dt.sessions.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            );
          })}

          <div className="flex flex-wrap gap-1.5 pt-1">
            {ACTIVITIES.slice(0, 4).map((a) => (
              <button
                key={a.id}
                className="btn btn-sm"
                onClick={() => onPatch({ sessions: [...dt.sessions, newSession(a.id)] })}
              >
                + {a.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 pt-1 text-xs">
            <span className="text-[var(--color-mut)]">Pin to a fixed kcal</span>
            <input
              type="number"
              className="field w-24 px-2 py-1 text-right text-xs"
              placeholder="auto"
              value={dt.fixed_kcal ?? ""}
              onChange={(e) =>
                onPatch({ fixed_kcal: e.target.value ? Number(e.target.value) : null })
              }
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button className="btn btn-sm btn-quiet" onClick={onDuplicate}>
              Duplicate
            </button>
            {canDelete && (
              <button className="btn btn-sm btn-quiet" onClick={onDelete}>
                Delete
              </button>
            )}
            <button className="btn btn-sm btn-accent ml-auto" onClick={onSave}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IngredientRow({
  it,
  advanced,
  shareable,
  onPatch,
  onRemove,
}: {
  it: BoundedItem;
  advanced: boolean;
  /** True when the meal has more than one ingredient to divide between. */
  shareable: boolean;
  onPatch: (p: Partial<BoundedItem>) => void;
  onRemove: () => void;
}) {
  const m = itemMacros(it);
  const check = macroConsistency(it);
  const food = profileFor(it.name, it);

  return (
    <div className="sunk px-3 py-2.5">
      {/* Line 1: what it is, and how much of it */}
      <div className="flex items-center gap-2">
        <input
          className="field field-bare mr-auto w-full min-w-0 flex-1 px-1.5 py-1 text-sm font-semibold"
          placeholder="Ingredient"
          value={it.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        <span className="num text-sm text-[var(--color-mut)]">{Math.round(m.kcal)} kcal</span>
        <input
          type="number"
          inputMode="decimal"
          className="field w-[4.5rem] py-1.5 text-right text-sm font-bold"
          value={it.grams}
          onChange={(e) => onPatch({ grams: Number(e.target.value) })}
        />
        <span className="w-2 text-xs text-[var(--color-mut)]">g</span>
        <button
          className="px-1 text-[#4a505c] transition hover:text-[var(--color-fat)]"
          title="Remove"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>

      {/* Line 2: the packet values, labelled once each */}
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#1c1f25] pt-2">
        <span className="label mr-1">per 100g</span>
        {(
          [
            ["kcal_100", "kcal", "var(--color-mut)"],
            ["protein_100", "P", MACRO_COLOR.protein],
            ["carbs_100", "C", MACRO_COLOR.carbs],
            ["fat_100", "F", MACRO_COLOR.fat],
          ] as const
        ).map(([key, tag, colour]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="text-[0.7rem] font-bold" style={{ color: colour }}>
              {tag}
            </span>
            <input
              type="number"
              inputMode="decimal"
              className="field w-[3.6rem] px-2 py-1 text-right text-xs"
              value={(it as any)[key] ?? 0}
              onChange={(e) => onPatch({ [key]: Number(e.target.value) } as Partial<BoundedItem>)}
            />
          </span>
        ))}
      </div>

      {/* Line 3: what the app worked out, and anything that looks wrong */}
      {(advanced || !check.ok) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#1c1f25] pt-2 text-[0.68rem]">
          {!check.ok && (
            <span style={{ color: "var(--color-carbs)" }}>
              4/4/9 says {Math.round(check.implied)} kcal, not {Math.round(check.stated)} — worth a
              second look at the label.
            </span>
          )}
          {advanced && (
            <>
              <span className="text-[#5b6270]">{food.spec.label.toLowerCase()}</span>
              <span className="text-[#5b6270]">{food.aisle.toLowerCase()}</span>
              <span className="flex items-center gap-1 text-[#5b6270]">
                limits
                <input
                  type="number"
                  className="field w-[3.4rem] px-1.5 py-0.5 text-right text-[0.68rem]"
                  placeholder="auto"
                  value={it.min_grams ?? ""}
                  onChange={(e) =>
                    onPatch({ min_grams: e.target.value ? Number(e.target.value) : null })
                  }
                />
                –
                <input
                  type="number"
                  className="field w-[3.4rem] px-1.5 py-0.5 text-right text-[0.68rem]"
                  placeholder="auto"
                  value={it.max_grams ?? ""}
                  onChange={(e) =>
                    onPatch({ max_grams: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </span>
              {/* Share of this meal's calories. Only means anything where the
                  meal has something to divide with. */}
              {shareable && (
                <span className="flex items-center gap-1 text-[#5b6270]">
                  share
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="field w-[3.4rem] px-1.5 py-0.5 text-right text-[0.68rem]"
                    placeholder="auto"
                    title="Share of this meal's calories. Leave empty to let the fit decide."
                    value={it.share_pct ?? ""}
                    onChange={(e) =>
                      onPatch({ share_pct: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                  %
                </span>
              )}
              <button
                className={it.locked ? "text-[var(--color-accent)]" : "text-[#5b6270]"}
                onClick={() => onPatch({ locked: !it.locked })}
              >
                {it.locked ? "locked" : "lock"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function totalGrams(meal: { ingredients: BoundedItem[] }): number {
  return meal.ingredients.reduce((a, i) => a + (Number(i.grams) || 0), 0);
}

function adjLabel(v: number): string {
  const n = Math.round(v * 1000) / 10;
  if (Math.abs(n) < 0.05) return "maintenance";
  return `${n > 0 ? "+" : ""}${n}% of maintenance`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function Num({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      className="field w-full"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
