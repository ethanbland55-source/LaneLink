"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RecalculateDialog } from "../recalculate";
import { applyDayFor, type PendingPortion } from "@/lib/pending";
import { EA_FLOOR, EA_OPTIMAL } from "@/lib/nutrition";
import {
  balancedEa,
  contextOf,
  fatCheck,
  lossRate,
  proteinVerdict,
  weekEnergy,
} from "@/lib/fuelling";
import { lastRollDay, nextRollDay } from "@/lib/weekly";
import { Bar, MACRO_COLOR, MACRO_LABEL, Segmented, Stat, type MacroKey } from "../macro-ui";
import { type BoundedItem } from "@/lib/optimise";
import { appliesOn, mealGroups, weekStanding, weeklyAverage, type PlanMeal } from "@/lib/weekfit";
import { dayVolume, volumeHeadline } from "@/lib/prep";
import { profileFor } from "@/lib/foods";
import { proteinDistribution } from "@/lib/protein";
import { fixedMacros, type Supplement } from "@/lib/supplements";
import { short } from "@/lib/evidence";
import { AddSupplement, References, SupplementRow } from "../supplements-ui";
import { NumberField } from "../number-field";
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
  addDays,
  WEEKDAY_LABEL,
  ageFromDob,
  buildWeekPlan,
  carbCheck,
  dayKey,
  estimatedBodyFat,
  goalDef,
  proteinIsAssumed,
  proteinTarget,
  itemMacros,
  macroConsistency,
  normaliseDayType,
  sumMacros,
  ZERO_MACROS,
  planWeight,
  targetsFor,
  totalFor,
  type DayType,
  type Goal,
  type Profile,
  type ProteinBasis,
  type Weekday,
} from "@/lib/nutrition";
import { DOW_LABELS, SHOP_DAY_OPTIONS, normaliseProfile } from "@/lib/profile";
import { lastShopDay } from "@/lib/weekly";

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
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecalc, setShowRecalc] = useState(false);
  const [planFor, setPlanFor] = useState<number>(0);
  const [advanced, setAdvanced] = useState(false);
  /** Portions agreed but waiting for roll day. See lib/pending.ts. */
  const [pending, setPending] = useState<PendingPortion[]>([]);
  /** Snapshots taken before each bulk rewrite, newest first. */
  const [snapshots, setSnapshots] = useState<{ id: number; changed_on: string; reason: string }[]>(
    []
  );
  const [restoring, setRestoring] = useState(false);
  /** What restoring from the log would change, so it can be seen first. */
  const [preview, setPreview] = useState<
    { meal_id: number; slot: number; name: string; grams: number; from: number | null }[]
  >([]);

  useEffect(() => {
    (async () => {
      const [p, m, dt, su, pe, hi] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
        fetch("/api/day-types").then((r) => r.json()),
        fetch("/api/supplements").then((r) => r.json()),
        fetch("/api/pending")
          .then((r) => r.json())
          .catch(() => ({ portions: [] })),
        fetch("/api/history")
          .then((r) => r.json())
          .catch(() => ({ snapshots: [] })),
      ]);
      setPreview([]);
      setPending(pe.portions ?? []);
      setSnapshots(hi.snapshots ?? []);
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
      setSupplements(su as Supplement[]);
      setLoading(false);
    })();
  }, []);

  const plan = useMemo(
    () => (profile ? buildWeekPlan(profile, dayTypes) : null),
    [profile, dayTypes]
  );

  const todayKey = useMemo(() => dayKey(), []);

  /** Energy availability, rate of loss and protein — the fuelling picture. */
  const energy = useMemo(
    () => (profile && plan ? weekEnergy(profile, plan) : []),
    [profile, plan]
  );
  const rate = useMemo(
    () =>
      profile && plan
        ? lossRate(profile, plan)
        : { pctPerWeek: 0, kgPerWeek: 0, verdict: "maintaining" as const, note: "" },
    [profile, plan]
  );
  /** Restricting, in balance, or in surplus — it changes what EA means. */
  const balance = useMemo(() => (plan ? contextOf(plan) : "balanced"), [plan]);
  const eaAtBalance = useMemo(
    () => (profile && plan ? balancedEa(profile, plan) : null),
    [profile, plan]
  );
  const fats = useMemo(
    () => (plan && profile ? fatCheck(plan, planWeight(profile)) : []),
    [plan, profile]
  );
  const lowFat = fats.filter((f) => f.days > 0 && f.verdict !== "ok");

  const proteinCheck = useMemo(() => {
    if (!plan || !profile) return proteinVerdict(0, 1);
    return proteinVerdict(targetsFor(plan, plan.order[0]).protein, planWeight(profile));
  }, [plan, profile]);

  /**
   * How far back the log has to be read to find the portions before they moved.
   *
   * Not this week. The weekly re-fit runs *on* roll day, so every entry since
   * then already carries the new numbers — reading only this week would anchor
   * on exactly the values you are trying to get rid of. The previous plan week
   * is where the old ones live.
   */
  const [logWindow, setLogWindow] = useState<{
    from: string;
    to: string;
    because: string;
  } | null>(null);
  /** The day a change made now would come into force. */
  const rollDay = useMemo(
    () =>
      profile
        ? applyDayFor(profile.plan_roll_dow ?? profile.shop_start_dow, todayKey)
        : todayKey,
    [profile, todayKey]
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

  /**
   * The whole week, not one day of it. Portions are shared across every kind of
   * day, so a plan that lands a rest day perfectly and runs 300 kcal over on
   * three swim days is not a plan that works — and looking at one day type at a
   * time is exactly how that goes unnoticed.
   */
  const standing = useMemo(
    () => (plan ? weekStanding(meals, plan, supplements) : []),
    [meals, plan, supplements]
  );
  const weekAvg = useMemo(
    () =>
      plan
        ? weeklyAverage(meals, plan, supplements)
        : { planned: ZERO_MACROS, target: ZERO_MACROS },
    [meals, plan, supplements]
  );
  const unusedTypes = standing.filter((d) => d.days === 0);

  /** What the supplements add to the day being looked at. */
  const suppMacros = useMemo(
    () => fixedMacros(supplements, planFor, dayTypes.length),
    [supplements, planFor, dayTypes.length]
  );

  /** Whether each kind of day carries the carbohydrate its training asks for. */
  const fuel = useMemo(
    () => (profile && plan ? carbCheck(profile, plan) : []),
    [profile, plan]
  );
  const usedDayTypes = useMemo(
    () => new Set(standing.filter((d) => d.days > 0).map((d) => d.id)),
    [standing]
  );
  const underFuelled = fuel.filter(
    (c) => c.verdict === "under_fuelled" && usedDayTypes.has(c.dayTypeId)
  );

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

  // The weekly roll moves the targets on shopping day; it does not touch the
  // portions, so say which of the two moved rather than leaving a bare number.
  const rolledThisWeek =
    !!profile?.plan_updated_on &&
    profile.plan_updated_on >= lastShopDay(profile.shop_start_dow);

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
  /**
   * Applying a rebalance, either now or on the day it is really for.
   *
   * Staged is the default and the honest one. Mid-week the containers in the
   * fridge already hold this week's portions; changing the numbers the app
   * shows does not change the food, it just makes the app wrong until Sunday.
   * So the new portions wait for roll day, and only the shopping list — which
   * is buying for the week after — reads them in the meantime.
   *
   * Shares are a different kind of thing and are saved either way: they are an
   * instruction to the solver rather than a weight on a plate, so there is
   * nothing about them that has to wait.
   */
  async function applyRecalc(next: PlanMeal[], when: "now" | "staged") {
    const merged = meals.map((m) => {
      const n = next.find((x) => x.id === m.id);
      return n ? { ...m, ingredients: n.ingredients, share_pct: n.share_pct ?? null } : m;
    });

    if (when === "now") {
      await Promise.all(merged.map(persist));
      setMeals(merged);
      setPending([]);
      setShowRecalc(false);
      flash("Week rebalanced");
      return;
    }

    /**
     * Shares now, portions later — and only the meals whose shares moved.
     *
     * Saving all of them was most of the several seconds this button used to
     * freeze for: one request each, serially, and each of those rewriting
     * every ingredient row one insert at a time. Almost every staging changes
     * no shares at all, so the honest number of saves here is usually zero.
     */
    const shareChanged = merged.filter((m) => {
      const live = meals.find((x) => x.id === m.id);
      if (!live) return false;
      if ((live.share_pct ?? null) !== (m.share_pct ?? null)) return true;
      return live.ingredients.some(
        (it, i) => (it.share_pct ?? null) !== (m.ingredients[i]?.share_pct ?? null)
      );
    });

    await Promise.all(
      shareChanged.map((m) => {
        const live = meals.find((x) => x.id === m.id) as Meal;
        return persist({
          ...live,
          share_pct: m.share_pct ?? null,
          ingredients: live.ingredients.map((it, i) => ({
            ...it,
            share_pct: m.ingredients[i]?.share_pct ?? null,
          })),
        } as Meal);
      })
    );

    // Keyed by meal, position and name — never by ingredient id. Saving a
    // meal above just deleted and re-inserted every ingredient row, so the ids
    // these objects are carrying are already stale. Position and name are what
    // survive that, on both sides.
    const portions = merged.flatMap((m) =>
      m.ingredients.map((it: any, slot: number) => ({
        meal_id: m.id,
        slot,
        name: it.name,
        grams: Number(it.grams),
      }))
    );
    const res = await fetch("/api/pending", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ portions, note: "Rebalanced" }),
    }).then((r) => r.json());

    if (res?.error) {
      flash("Couldn't stage that — nothing changed");
      return;
    }

    await loadPending();
    setShowRecalc(false);
    flash(
      res.count > 0
        ? `${res.count} portion${res.count === 1 ? "" : "s"} staged`
        : "Nothing needed changing"
    );
  }

  // The preview needs the window, which needs the profile, so it comes after
  // the first load rather than as part of it.
  useEffect(() => {
    if (!profile) return;
    let live = true;
    // No window passed: the server works out how far back to read from when
    // the plan actually last changed, which the client has no way to know.
    fetch("/api/history")
      .then((r) => r.json())
      .then((r) => {
        if (!live) return;
        setSnapshots(r.snapshots ?? []);
        setPreview(r.preview ?? []);
        setLogWindow(r.window ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [profile]);

  async function loadPending() {
    try {
      const r = await fetch("/api/pending").then((x) => x.json());
      setPending(r.portions ?? []);
    } catch {
      setPending([]);
    }
  }

  async function discardStaged() {
    await fetch("/api/pending", { method: "DELETE" });
    setPending([]);
    flash("Staged changes discarded");
  }

  /**
   * Put the portions back — either to a snapshot, or to what the log says.
   *
   * The log route exists because the first automatic re-fit happened before
   * there was any history to undo it with. Every logged meal stores its items
   * exactly as they were when it was tapped, so the log is a record of what
   * the plan said on the day. It only covers meals actually logged, which is
   * the honest limit of it.
   */
  async function undo(body: object, what: string) {
    setRestoring(true);
    const res = await fetch("/api/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    setRestoring(false);

    if (res?.error || (res.restored === 0 && res.reason)) {
      flash(res.reason ?? "Couldn't restore");
      return;
    }

    const m = await fetch("/api/meals").then((r) => r.json());
    setMeals(
      (m as any[]).map((x) => ({
        ...x,
        times_per_day: Number(x.times_per_day ?? 1),
        day_type_ids: x.day_type_ids ?? null,
        batch: !!x.batch,
        share_pct: x.share_pct ?? null,
      }))
    );
    const hi = await fetch("/api/history").then((r) => r.json());
    setSnapshots(hi.snapshots ?? []);
    setPreview(hi.preview ?? []);
    setLogWindow(hi.window ?? null);
    flash(
      res.restored > 0
        ? `${what} — ${res.restored} portion${res.restored === 1 ? "" : "s"} put back`
        : "Nothing needed putting back"
    );
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

  /* ---- supplements ---- */

  async function addSupp(s: Partial<Supplement>) {
    const res = await fetch("/api/supplements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const created = await res.json();
    setSupplements((list) => [...list, created]);
    flash("Added");
  }

  function patchSupp(id: number, p: Partial<Supplement>) {
    setSupplements((list) => list.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  async function saveSupp(id: number) {
    const s = supplements.find((x) => x.id === id);
    if (!s) return;
    await fetch("/api/supplements", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    flash("Saved");
  }

  async function deleteSupp(id: number) {
    await fetch(`/api/supplements?id=${id}`, { method: "DELETE" });
    setSupplements((list) => list.filter((s) => s.id !== id));
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
          supplements={supplements}
          defaultMode={profile.calorie_override != null ? "calories_exact" : "balanced"}
          applyOn={rollDay === todayKey ? null : rollDay}
          onClose={() => setShowRecalc(false)}
          onApply={applyRecalc}
        />
      )}

      {/* Staged, not yet in force. The one thing you must be able to see at a
          glance, because otherwise the plan on screen and the plan the shop
          bought for disagree with nothing to explain why. */}
      {pending.length > 0 && (
        <section className="card border border-[var(--color-carbs)]/30 px-5 py-4">
          <div className="flex items-baseline gap-3">
            <p className="mr-auto text-sm font-bold">
              {pending.length} portion{pending.length === 1 ? "" : "s"} waiting for{" "}
              {new Date(pending[0].apply_on + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}
            </p>
            <button className="btn btn-sm shrink-0" onClick={discardStaged}>
              Discard
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-mut)]">
            The plan below is what is in the fridge this week. The shopping list is already
            buying for these.
          </p>
          <ul className="mt-2.5 space-y-0.5">
            {pending.slice(0, 6).map((c) => (
              <li
                key={`${c.meal_id}:${c.slot}`}
                className="flex items-baseline gap-2 text-xs text-[var(--color-mut)]"
              >
                <span className="truncate">
                  {c.meal_name} · {c.name}
                </span>
                <span className="ml-auto shrink-0 tabular-nums">
                  {c.was_grams != null ? `${Math.round(c.was_grams)} → ` : ""}
                  {Math.round(c.grams)} g
                </span>
              </li>
            ))}
          </ul>
          {pending.length > 6 && (
            <p className="mt-1 text-[0.7rem] text-[var(--color-mut)]">
              and {pending.length - 6} more
            </p>
          )}
        </section>
      )}

      {/* Lean, fuelled, fast — the three numbers that decide whether getting
          leaner is costing you the swimming. Placed above the week because a
          calorie average that looks fine can hide a day that isn't. */}
      {plan && profile && energy.length > 0 && (
        <section className="card px-5 py-5">
          <p className="label">Fuelled enough to train</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-mut)]">
            What each day leaves you once the session is paid for, per kg of lean mass. Under{" "}
            {EA_FLOOR} is where training and recovery start to go, and the scale won&rsquo;t warn
            you — swimmers in that state have lost speed at perfectly steady bodyweight. The plan
            holds every day above it.
          </p>

          <div className="mt-3 space-y-1.5">
            {energy
              .filter((d) => d.days > 0)
              .map((d) => {
                const pctOf = Math.min(1, (d.ea ?? 0) / (EA_OPTIMAL * 1.25));
                const colour =
                  d.band === "low"
                    ? "var(--color-fat)"
                    : d.band === "reduced"
                      ? "var(--color-carbs)"
                      : "var(--color-accent)";
                return (
                  <div key={d.dayTypeId} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-xs">{d.name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface)]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${pctOf * 100}%`, background: colour }}
                      />
                    </span>
                    <span
                      className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums"
                      style={{ color: colour }}
                    >
                      {d.ea ?? "—"}
                    </span>
                  </div>
                );
              })}
          </div>

          {energy.some((d) => d.days > 0 && d.band === "reduced") && (
            <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-mut)]">
              {balance === "restricting" ? (
                <>
                  Between {EA_FLOOR} and {EA_OPTIMAL} while eating under maintenance. Fine for a
                  short, deliberate block; not where to spend a season.
                </>
              ) : (
                <>
                  These read between {EA_FLOOR} and {EA_OPTIMAL}, but you are eating at
                  maintenance, so this is arithmetic rather than under-fuelling — at energy balance
                  the figure is just your resting cost times your daily activity, divided by lean
                  mass{eaAtBalance ? `, which comes to ${eaAtBalance}` : ""}. Eating more would not
                  raise it without putting you in surplus. If it looks low, the number to question
                  is your everyday activity setting, not your plate.
                </>
              )}
            </p>
          )}
          {plan.order.some((id) => targetsFor(plan, id).eaFloored) && (
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
              Some days have been raised above what your deficit asked for, to keep them above the
              floor. That is deliberate: the fat can come off next month and the season can&rsquo;t
              be got back.
            </p>
          )}

          {lowFat.length > 0 && (
            <p
              className="mt-2.5 text-xs leading-relaxed"
              style={{ color: lowFat.some((f) => f.verdict === "low") ? "var(--color-fat)" : "var(--color-carbs)" }}
            >
              Fat is down to {Math.min(...lowFat.map((f) => f.grams))} g on your lightest day —{" "}
              {(Math.min(...lowFat.map((f) => f.pctKcal)) * 100).toFixed(0)}% of calories. The
              guidance for athletes is 20–35%, and going under 20% buys no performance while
              low-fat intakes in men track with lower testosterone — which is the side of this
              doing the muscle-keeping. Worth a look at your fat per kg.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-[#1c1f25] pt-3 text-xs">
            <span className="text-[var(--color-mut)]">
              Rate{" "}
              <b className="text-[var(--color-fg)]">
                {(rate.pctPerWeek * 100).toFixed(2)}%/wk
              </b>{" "}
              · {rate.verdict.replace("_", " ")}
            </span>
            <span className="text-[var(--color-mut)]">
              Protein <b className="text-[var(--color-fg)]">{proteinCheck.perKg.toFixed(2)} g/kg</b>{" "}
              · {proteinCheck.verdict.replace("_", " ")}
            </span>
          </div>
          <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[var(--color-mut)]">
            {rate.note}
          </p>
          {proteinCheck.verdict !== "in_range" && (
            <p className="mt-1 text-[0.7rem] leading-relaxed text-[var(--color-mut)]">
              {proteinCheck.note}
            </p>
          )}
        </section>
      )}

      {/* Putting the portions back.
          The weekly re-fit runs without anyone pressing anything, which is the
          right behaviour and also the reason this has to exist: you can open
          the app on a Monday, find the numbers have moved, and want to say
          that was fine as it was. */}
      {(snapshots.length > 0 || meals.length > 0) && (
        <section className="card px-5 py-4">
          <p className="text-sm font-bold">Put the portions back</p>
          {snapshots.length > 0 ? (
            <>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-mut)]">
                Every automatic rewrite takes a copy first.
              </p>
              <div className="mt-2.5 space-y-1.5">
                {snapshots.slice(0, 3).map((sn) => (
                  <div key={sn.id} className="flex items-center gap-3">
                    <span className="mr-auto min-w-0 truncate text-xs text-[var(--color-mut)]">
                      Before the {sn.reason} on{" "}
                      {new Date(sn.changed_on + "T12:00:00").toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <button
                      className="btn btn-sm shrink-0"
                      disabled={restoring}
                      onClick={() => undo({ id: sn.id }, "Restored")}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-mut)]">
              Nothing has been rewritten since copies started being kept. If the portions changed
              before that, the log still remembers them — every meal you tapped stored its
              amounts as they were that day.
            </p>
          )}

          <div className="mt-3 border-t border-[#1c1f25] pt-3">
            <div className="flex items-center gap-3">
              <span className="mr-auto min-w-0 text-xs font-semibold">
                {preview.length > 0
                  ? `${preview.length} portion${preview.length === 1 ? "" : "s"} disagree with your log`
                  : "Rebuild the portions from what you logged"}
              </span>
              <button
                className={`btn btn-sm shrink-0 ${preview.length > 0 ? "btn-accent" : ""}`}
                disabled={restoring || !logWindow || preview.length === 0}
                onClick={() =>
                  logWindow && undo({ ...logWindow }, "Rebuilt from your log")
                }
              >
                {restoring ? "Working…" : preview.length > 0 ? "Put them back" : "Nothing to do"}
              </button>
            </div>

            {preview.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {preview.slice(0, 8).map((c) => (
                  <li
                    key={`${c.meal_id}:${c.slot}`}
                    className="flex items-baseline gap-2 text-xs text-[var(--color-mut)]"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {Math.round(c.from ?? 0)} &rarr;{" "}
                      <b className="text-[var(--color-fg)]">{Math.round(c.grams)}</b> g
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[var(--color-mut)]">
              {logWindow?.because
                ? `${logWindow.because[0].toUpperCase()}${logWindow.because.slice(1)}, back to ${logWindow.from}. `
                : ""}
              Every logged day votes, a one-off mis-weigh loses, and locked portions are left alone.
            </p>
          </div>
        </section>
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

        {rolledThisWeek && weekOff && (
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
            Your weigh-ins moved these targets on{" "}
            {new Date(profile.plan_updated_on + "T12:00:00").toLocaleDateString(undefined, {
              weekday: "long",
            })}
            . The portions are still last week's — rebalance to catch them up.
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
                <NumberField
                  min={0.5}
                  step={0.5}
                  className="w-16 px-2 py-1 text-right text-xs"
                  value={meal.times_per_day}
                  onCommit={(v) => patchMeal(meal.id, { times_per_day: v ?? 1 })}
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
                  <NumberField
                    min={0}
                    max={100}
                    placeholder="auto"
                    allowEmpty
                    className="w-16 px-2 py-1 text-right text-xs"
                    title="How much of what this group of meals adds up to should be this one. Leave empty to let the fit decide."
                    value={meal.share_pct}
                    onCommit={(v) => patchMeal(meal.id, { share_pct: v })}
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

      {/* Supplements */}
      <section className="card px-4 py-4 sm:px-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Supplements</p>
          {suppMacros.kcal > 0 && (
            <p className="text-xs text-[var(--color-mut)]">
              +{Math.round(suppMacros.kcal)} kcal, {Math.round(suppMacros.protein)} g protein a day
            </p>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
          A dose you take, not a portion you weigh — so the fit counts them toward the day and
          never resizes them to hit a number. Each one is graded on the evidence behind it, which
          for some of them is the most useful thing on the card.
        </p>

        {supplements.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {supplements.map((s) => (
              <SupplementRow
                key={s.id}
                s={s}
                meals={meals.map((m) => ({ id: m.id, name: m.name }))}
                dayTypes={plan.dayTypes.map((d) => ({ id: d.id, name: d.name }))}
                onPatch={(p) => patchSupp(s.id, p)}
                onSave={() => saveSupp(s.id)}
                onDelete={() => deleteSupp(s.id)}
              />
            ))}
          </div>
        )}

        <AddSupplement onAdd={addSupp} existing={supplements.map((s) => s.name)} />
      </section>

      {/* Fuelling the work */}
      <section className="card px-5 py-5">
        <p className="label">Fuelling the work</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
          Carbohydrate need scales with the training a day holds, not with the size of its calorie
          budget — which is the check a percentage-based macro split can never make, and the one
          that matters most in a pool. Bands from {short("burke2011")}, applied to swimming by{" "}
          {short("shaw2014")}.
        </p>

        <div className="mt-4 space-y-1.5">
          {fuel
            .filter((c) => usedDayTypes.has(c.dayTypeId))
            .map((c) => {
              const colour =
                c.verdict === "under_fuelled"
                  ? "var(--color-carbs)"
                  : c.verdict === "in"
                    ? "var(--color-accent)"
                    : "var(--color-mut)";
              return (
                <div key={c.dayTypeId} className="sunk px-3.5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="mr-auto text-sm font-medium">{c.name}</span>
                    <span className="text-[0.68rem] text-[#5b6270]">
                      {c.band.label.toLowerCase()} · {c.loadMinutes} min
                    </span>
                    <span className="num text-sm" style={{ color: colour }}>
                      {c.perKg} g/kg
                    </span>
                  </div>
                  <p className="mt-1 text-[0.68rem] text-[#5b6270]">
                    {c.grams} g of a {c.lowGrams}–{c.highGrams} g band
                    {c.verdict === "under_fuelled" && (
                      <span style={{ color: "var(--color-carbs)" }}>
                        {" "}
                        — under-fuelled for the work
                      </span>
                    )}
                    {c.verdict === "low_by_design" && " — low, which is the point on a light day"}
                  </p>
                </div>
              );
            })}
        </div>

        {underFuelled.length > 0 && (
          <div className="mt-3 rounded-xl bg-[#2a2416] px-3.5 py-3 text-xs leading-relaxed text-[#ffd08a]">
            <p>
              {underFuelled.map((c) => c.name.toLowerCase()).join(" and ")}{" "}
              {underFuelled.length === 1 ? "sits" : "sit"} below the band its training asks for.
              You&rsquo;re running a deficit, so you can&rsquo;t clear these and shouldn&rsquo;t
              try — the bands assume energy balance. What you can do is put the carbohydrate you do
              have around the session rather than spreading it flat: a pre-swim top-up and a
              post-swim refill buy more training quality than the same grams at breakfast.
            </p>
          </div>
        )}

        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[var(--color-mut)]">
            Where these numbers come from
          </summary>
          <References
            keys={[
              "burke2011",
              "thomas2016",
              "shaw2014",
              "impey2018",
              "jager2017",
              "morton2018",
              "helms2014",
              "barakat2020",
              "areta2013",
              "mifflin1990",
              "ainsworth2011",
            ]}
          />
        </details>
      </section>

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

        <label className="mt-3 block">
          <span className="label mb-1.5 block">Plan rolls over on</span>
          <select
            className="field w-full max-w-[13rem]"
            value={profile.plan_roll_dow}
            onChange={(e) => set("plan_roll_dow", Number(e.target.value))}
          >
            {DOW_LABELS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
          Not the same day as the shop, and shouldn't be. You buy on{" "}
          {DOW_LABELS[profile.shop_start_dow].toLowerCase()} for food you start eating on{" "}
          {DOW_LABELS[profile.plan_roll_dow].toLowerCase()} — so the shopping list is built
          against next week's targets, while the plan you're still eating holds still until
          then. The block's drift steps on this day too, once a week rather than every
          morning.
        </p>

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
              <NumberField
                className="w-full"
                allowEmpty
                value={profile.calorie_override}
                placeholder={`${plan.maintenance} — calculated`}
                onCommit={(v) => set("calorie_override", v)}
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
                <NumberField
                  min={0}
                  step={5}
                  className="w-[4.2rem] px-2 py-1 text-right text-xs"
                  value={s.minutes}
                  onCommit={(v) => patchSession(i, { minutes: v ?? 0 })}
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
            <NumberField
              className="w-24 px-2 py-1 text-right text-xs"
              placeholder="auto"
              allowEmpty
              value={dt.fixed_kcal}
              onCommit={(v) => onPatch({ fixed_kcal: v })}
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
        <NumberField
          className="w-[4.5rem] py-1.5 text-right text-sm font-bold"
          value={it.grams}
          onCommit={(v) => v != null && onPatch({ grams: v })}
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
            <NumberField
              className="w-[3.6rem] px-2 py-1 text-right text-xs"
              value={(it as any)[key] ?? 0}
              onCommit={(v) =>
                v != null && onPatch({ [key]: v } as Partial<BoundedItem>)
              }
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
                <NumberField
                  className="w-[3.4rem] px-1.5 py-0.5 text-right text-[0.68rem]"
                  placeholder="auto"
                  allowEmpty
                  value={it.min_grams}
                  onCommit={(v) => onPatch({ min_grams: v })}
                />
                –
                <NumberField
                  className="w-[3.4rem] px-1.5 py-0.5 text-right text-[0.68rem]"
                  placeholder="auto"
                  allowEmpty
                  value={it.max_grams}
                  onCommit={(v) => onPatch({ max_grams: v })}
                />
              </span>
              {/* Share of this meal's calories. Only means anything where the
                  meal has something to divide with. */}
              {shareable && (
                <span className="flex items-center gap-1 text-[#5b6270]">
                  share
                  <NumberField
                    min={0}
                    max={100}
                    className="w-[3.4rem] px-1.5 py-0.5 text-right text-[0.68rem]"
                    placeholder="auto"
                    allowEmpty
                    title="Share of this meal's calories. Leave empty to let the fit decide."
                    value={it.share_pct}
                    onCommit={(v) => onPatch({ share_pct: v })}
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
    <NumberField
      step={step}
      className="w-full"
      value={value}
      onCommit={(v) => v != null && onChange(v)}
    />
  );
}
