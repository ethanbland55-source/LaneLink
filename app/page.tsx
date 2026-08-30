"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, MacroChips, MacroTile, Segmented } from "./macro-ui";
import {
  addDays,
  buildWeekPlan,
  dayKey,
  dayTypeIdFor,
  itemMacros,
  normaliseDayType,
  sumMacros,
  targetsFor,
  totalFor,
  type DayType,
  type Item,
  type Profile,
} from "@/lib/nutrition";
import { activityLabel } from "@/lib/activities";
import { appliesOn } from "@/lib/shopping";
import { servingGrams, servingsByDayType } from "@/lib/batch";
import { normaliseProfile } from "@/lib/profile";

type Meal = {
  id: number;
  name: string;
  times_per_day?: number;
  day_type_ids?: number[] | null;
  batch?: boolean;
  ingredients: Item[];
};
type Entry = {
  id: number;
  meal_id: number | null;
  meal_name: string;
  confirmed: boolean;
  items: Item[];
};

const OVERRIDE_KEY = "mealhub.dayType";

export default function TodayPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [dayTypes, setDayTypes] = useState<DayType[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [day, setDay] = useState(dayKey());
  const [override, setOverride] = useState<number | null>(null);
  const [followToday, setFollowToday] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    try {
      const [p, m, l, dt] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
        fetch(`/api/log?day=${d}`).then((r) => r.json()),
        fetch("/api/day-types").then((r) => r.json()),
      ]);
      setProfile(normaliseProfile(p));
      setMeals(m);
      setEntries(l);
      setDayTypes((dt as any[]).map((x, i) => normaliseDayType(x, i)));
      setError(null);
    } catch {
      setError("Can't reach the database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(day);
  }, [day, load]);

  // Today's day type can be nudged without rewriting the whole week — you
  // swapped a session for a rest day, it happens.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${OVERRIDE_KEY}:${day}`);
      setOverride(raw ? Number(raw) || null : null);
    } catch {
      setOverride(null);
    }
  }, [day]);

  function chooseDayType(dt: number) {
    setOverride(dt);
    try {
      localStorage.setItem(`${OVERRIDE_KEY}:${day}`, String(dt));
    } catch {
      /* private mode — the choice just won't survive a refresh */
    }
  }

  // The logging day turns over at 03:00; catch it without a refresh — but
  // only while you're actually looking at today, not browsing back.
  useEffect(() => {
    const t = setInterval(() => {
      if (!followToday) return;
      const k = dayKey();
      setDay((prev) => (k === prev ? prev : k));
    }, 60_000);
    return () => clearInterval(t);
  }, [followToday]);

  const plan = useMemo(
    () => (profile ? buildWeekPlan(profile, dayTypes) : null),
    [profile, dayTypes]
  );

  const dayTypeId = useMemo(() => {
    if (!plan) return 0;
    return override && plan.byId[override] ? override : dayTypeIdFor(plan, day);
  }, [override, plan, day]);

  const target = useMemo(
    () => (plan ? targetsFor(plan, dayTypeId) : null),
    [plan, dayTypeId]
  );

  const eaten = useMemo(
    () => sumMacros(entries.filter((e) => e.confirmed).map((e) => totalFor(e.items))),
    [entries]
  );

  const suggested = useMemo(
    () => meals.filter((m) => appliesOn(m, dayTypeId, dayTypes.length)),
    [meals, dayTypeId, dayTypes.length]
  );

  /**
   * How much of each cooked batch belongs on the plate today. Worked out by
   * the same function the cook list uses, so the number on the kitchen scale
   * is the number the log is expecting.
   */
  const servings = useMemo(
    () => (plan ? servingsByDayType(meals as any, plan) : new Map()),
    [meals, plan]
  );

  /** Step a day back or forward; stop auto-rollover unless we're on today. */
  function go(delta: number) {
    setDay((d) => {
      const next = addDays(d, delta);
      setFollowToday(next === dayKey());
      return next;
    });
  }

  /** A batch meal is logged at today's serving, not the plan's base serving. */
  function itemsFor(meal: Meal): Item[] {
    const base = meal.ingredients.map(stripItem);
    if (!meal.batch) return base;
    const planned = servingGrams({ ...meal, ingredients: meal.ingredients } as any);
    const today = servings.get(meal.id)?.get(dayTypeId);
    if (!planned || !today) return base;
    const scale = today / planned;
    return base.map((i) => ({ ...i, grams: Math.round(i.grams * scale * 10) / 10 }));
  }

  async function addMeal(meal: Meal) {
    const res = await fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        day,
        meal_id: meal.id,
        meal_name: meal.name,
        day_type_id: dayTypeId,
        items: itemsFor(meal),
      }),
    });
    const created = await res.json();
    setEntries((e) => [...e, created]);
  }

  async function saveEntry(entry: Entry, confirmed: boolean) {
    const res = await fetch("/api/log", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: entry.id, items: entry.items, confirmed }),
    });
    const saved = await res.json();
    setEntries((list) => list.map((e) => (e.id === saved.id ? { ...saved } : e)));
  }

  async function confirmAll() {
    const pending = entries.filter((e) => !e.confirmed);
    for (const e of pending) await saveEntry(e, true);
  }

  async function removeEntry(id: number) {
    await fetch(`/api/log?id=${id}`, { method: "DELETE" });
    setEntries((list) => list.filter((e) => e.id !== id));
  }

  function setGrams(entryId: number, idx: number, grams: number) {
    setEntries((list) =>
      list.map((e) =>
        e.id !== entryId
          ? e
          : { ...e, items: e.items.map((it, i) => (i === idx ? { ...it, grams } : it)) }
      )
    );
  }

  if (loading) return <p className="py-24 text-center text-sm text-[var(--color-mut)]">Loading…</p>;
  if (!profile || !target || !plan) {
    return (
      <p className="py-24 text-center text-sm text-[var(--color-fat)]">
        {error ?? "Something went wrong."}
      </p>
    );
  }

  const left = Math.round(target.kcal - eaten.kcal);
  const over = left < 0;
  const isToday = day === dayKey();
  const pending = entries.filter((e) => !e.confirmed).length;

  return (
    <div className="space-y-3">
      {error && <div className="card px-5 py-3 text-sm text-[var(--color-fat)]">{error}</div>}

      {/* Hero — one number, the one that matters */}
      <section className="card px-5 py-6">
        <div className="flex items-start">
          <div className="mr-auto">
            <p className="label">{over ? "Over by" : "Remaining"}</p>
            <p
              className="num mt-2 text-[4rem] sm:text-[4.75rem]"
              style={{ color: over ? "var(--color-fat)" : "#f2f4f7" }}
            >
              {Math.abs(left).toLocaleString()}
            </p>
          </div>
          <div className="pt-1 text-right">
            <div className="flex items-center justify-end gap-1">
              <button
                className="btn btn-sm btn-quiet px-2"
                onClick={() => go(-1)}
                aria-label="Previous day"
              >
                ‹
              </button>
              <span className="text-xs text-[var(--color-mut)]">
                {isToday ? "Today" : prettyDay(day)}
              </span>
              <button
                className="btn btn-sm btn-quiet px-2 disabled:opacity-20"
                disabled={isToday}
                onClick={() => go(1)}
                aria-label="Next day"
              >
                ›
              </button>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-mut)]">
              {Math.round(eaten.kcal).toLocaleString()} of {target.kcal.toLocaleString()} kcal
            </p>
          </div>
        </div>

        <div className="mt-5">
          <Bar value={eaten.kcal} target={target.kcal} color="var(--color-accent)" height={8} />
        </div>

        {profile.cycling && plan.dayTypes.length > 0 && (
          <div className="mt-5">
            <p className="label mb-2">Today</p>
            <Segmented
              size="sm"
              value={dayTypeId}
              onChange={chooseDayType}
              options={plan.dayTypes.map((d) => ({ value: d.id, label: d.name }))}
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
              {target.sessions.length > 0
                ? target.sessions
                    .map((x) => `${activityLabel(x)}, ${x.minutes} min`)
                    .join(" · ")
                : "Nothing on."}
              {Math.abs(target.multiplier - 1) > 0.005 && (
                <>
                  {" — "}
                  {target.multiplier > 1 ? "+" : ""}
                  {Math.round((target.multiplier - 1) * 100)}% on your{" "}
                  {plan.goalKcal.toLocaleString()} kcal average
                  {target.sessionKcal > 0 && `, ${target.sessionKcal} kcal of training`}.
                </>
              )}
            </p>
            {override != null && override !== dayTypeIdFor(plan, day) && (
              <button
                className="btn btn-sm btn-quiet mt-2"
                onClick={() => {
                  setOverride(null);
                  try {
                    localStorage.removeItem(`${OVERRIDE_KEY}:${day}`);
                  } catch {
                    /* nothing to clean up */
                  }
                }}
              >
                Back to the usual {targetsFor(plan, dayTypeIdFor(plan, day)).name.toLowerCase()}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Macros */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MacroTile k="protein" eaten={eaten.protein} target={target.protein} />
        <MacroTile k="carbs" eaten={eaten.carbs} target={target.carbs} />
        <MacroTile k="fat" eaten={eaten.fat} target={target.fat} />
        <MacroTile k="fibre" eaten={eaten.fibre} target={target.fibre} overIsFine />
      </section>

      {/* Add a meal */}
      {meals.length === 0 ? (
        <section className="card px-5 py-10 text-center">
          <p className="text-sm text-[var(--color-mut)]">No meals in your plan yet.</p>
          <Link href="/plan" className="btn btn-accent mt-4">
            Build your plan
          </Link>
        </section>
      ) : (
        <section className="card px-5 py-4">
          <div className="mb-3 flex items-center">
            <p className="label mr-auto">Add a meal</p>
            {pending > 0 && (
              <button className="btn btn-sm btn-accent" onClick={confirmAll}>
                Confirm all {pending}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {suggested.map((m) => {
              // Show what you'd actually log today, which for a batch is
              // today's serving rather than the plan's base one.
              const t = totalFor(itemsFor(m));
              const used = entries.filter((e) => e.meal_id === m.id).length;
              const planned = Math.max(1, Number(m.times_per_day ?? 1));
              return (
                <button
                  key={m.id}
                  onClick={() => addMeal(m)}
                  className="sunk group flex items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[#161a1f]"
                >
                  <span className="text-lg font-light leading-none text-[var(--color-accent)]">+</span>
                  <span>
                    <span className="block text-sm font-semibold">{m.name}</span>
                    <span className="block text-xs tabular-nums text-[var(--color-mut)]">
                      {Math.round(t.kcal)} kcal
                      {planned > 1 && ` · ${planned}× a day`}
                      {m.batch && servings.get(m.id)?.get(dayTypeId) != null && (
                        <> · weigh {servings.get(m.id)!.get(dayTypeId)} g</>
                      )}
                    </span>
                  </span>
                  {used > 0 && (
                    <span
                      className="num ml-1 rounded-full px-1.5 py-0.5 text-[0.65rem]"
                      style={{
                        background:
                          used >= planned ? "var(--color-accent)" : "var(--color-raised)",
                        color: used >= planned ? "#10160a" : "var(--color-mut)",
                      }}
                    >
                      {used}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {suggested.length < meals.length && (
            <p className="mt-3 text-xs text-[var(--color-mut)]">
              {meals.length - suggested.length} meal
              {meals.length - suggested.length === 1 ? "" : "s"} hidden — not part of a{" "}
              {target.name.toLowerCase()} day.
            </p>
          )}
        </section>
      )}

      {/* The day's log */}
      {entries.length > 0 && (
        <section className="space-y-3">
          {entries.map((e) => {
            const t = totalFor(e.items);
            return (
              <div key={e.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-5 pt-4">
                  <div className="mr-auto min-w-0">
                    <p className="truncate font-semibold">{e.meal_name}</p>
                    <div className="mt-1">
                      <MacroChips m={t} fibre />
                    </div>
                  </div>
                  {e.confirmed ? (
                    <button className="btn btn-sm btn-quiet" onClick={() => saveEntry(e, false)}>
                      Edit
                    </button>
                  ) : (
                    <button className="btn btn-sm btn-accent" onClick={() => saveEntry(e, true)}>
                      Confirm
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-quiet px-2"
                    title="Remove"
                    onClick={() => removeEntry(e.id)}
                  >
                    ✕
                  </button>
                </div>

                {/* Ingredients are only worth showing while you're adjusting them. */}
                {!e.confirmed && (
                  <div className="mt-3 space-y-1.5 px-5 pb-4">
                    {e.items.map((it, i) => {
                      const m = itemMacros(it);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="mr-auto min-w-0 flex-1 truncate text-sm">{it.name}</span>
                          <span className="hidden text-xs tabular-nums text-[var(--color-mut)] sm:block">
                            {Math.round(m.kcal)} kcal
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            className="field w-[4.5rem] py-1.5 text-right text-sm"
                            value={it.grams}
                            onChange={(ev) => setGrams(e.id, i, Number(ev.target.value))}
                          />
                          <span className="w-2 text-xs text-[var(--color-mut)]">g</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {e.confirmed && <div className="h-4" />}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function stripItem(i: Item): Item {
  return {
    name: i.name,
    grams: Number(i.grams),
    kcal_100: Number(i.kcal_100),
    protein_100: Number(i.protein_100),
    carbs_100: Number(i.carbs_100),
    fat_100: Number(i.fat_100),
    fibre_100: Number(i.fibre_100 ?? 0),
  };
}

function prettyDay(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
