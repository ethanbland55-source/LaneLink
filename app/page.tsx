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
  planWeight,
  sumMacros,
  targetsFor,
  totalFor,
  type DayType,
  type Item,
  type Profile,
} from "@/lib/nutrition";
import { activityLabel } from "@/lib/activities";
import { doseSpacing } from "@/lib/protein";
import { NumberField } from "./number-field";
import {
  TIMING_LABEL,
  doseLabel,
  repsOf as suppReps,
  specFor,
  suppAppliesOn,
  type Supplement,
} from "@/lib/supplements";
import { GRADE_COLOUR } from "@/lib/evidence";
import { appliesOn } from "@/lib/shopping";
import { hasPrepped, servingGrams } from "@/lib/batch";

import { normaliseProfile } from "@/lib/profile";
import { CheatCard, CheatSheet } from "./cheat-ui";
import { absorbCheat, cheatForWeek, daysAfter, type CheatMeal } from "@/lib/cheat";
import { lastRollDay, nextRollDay } from "@/lib/weekly";

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
  /** Clock time it was eaten, "HH:MM". Null on anything logged before times. */
  at_time?: string | null;
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
  /** Which meal has its "had it earlier" time picker open. */
  const [timeFor, setTimeFor] = useState<number | null>(null);
  const [pickTime, setPickTime] = useState("");
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  /** How many of each supplement have been taken today. */
  const [takenMap, setTakenMap] = useState<Map<number, number>>(new Map());
  /** Cheat meals in the plan week around `day` — at most one counts. */
  const [cheats, setCheats] = useState<CheatMeal[]>([]);
  const [showCheat, setShowCheat] = useState(false);

  const load = useCallback(async (d: string) => {
    try {
      const [p, m, l, dt, su, sl, ch] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
        fetch(`/api/log?day=${d}`).then((r) => r.json()),
        fetch("/api/day-types").then((r) => r.json()),
        fetch("/api/supplements").then((r) => r.json()),
        fetch(`/api/supplement-log?day=${d}`).then((r) => r.json()),
        fetch(`/api/cheat?from=${addDays(d, -7)}&to=${addDays(d, 7)}`)
          .then((r) => r.json())
          .catch(() => []),
      ]);
      setCheats(Array.isArray(ch) ? ch : []);
      setProfile(normaliseProfile(p));
      setMeals(m);
      setEntries(l);
      setDayTypes((dt as any[]).map((x, i) => normaliseDayType(x, i)));
      setSupplements(su as Supplement[]);
      setTakenMap(
        new Map((sl as any[]).map((r) => [Number(r.supplement_id), Number(r.taken)]))
      );
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

  const todaysSupps = useMemo(
    () => supplements.filter((s) => suppAppliesOn(s, dayTypeId, dayTypes.length)),
    [supplements, dayTypeId, dayTypes.length]
  );

  /**
   * What's gone in. Supplements count only once actually ticked off, the same
   * as a meal counts only once confirmed — a plan is not a record.
   */
  const eaten = useMemo(() => {
    const food = sumMacros(entries.filter((e) => e.confirmed).map((e) => totalFor(e.items)));
    for (const s of todaysSupps) {
      const n = takenMap.get(s.id) ?? 0;
      if (!n) continue;
      food.kcal += (Number(s.kcal) || 0) * n;
      food.protein += (Number(s.protein) || 0) * n;
      food.carbs += (Number(s.carbs) || 0) * n;
      food.fat += (Number(s.fat) || 0) * n;
    }
    return food;
  }, [entries, todaysSupps, takenMap]);

  const suggested = useMemo(
    () => meals.filter((m) => appliesOn(m, dayTypeId, dayTypes.length)),
    [meals, dayTypeId, dayTypes.length]
  );

  /* --- the cheat meal, and what the week does about it ----------------- */

  /**
   * The plan week `day` falls in: roll day to the day before the next one.
   *
   * The allowance is one a week and the week that matters is the plan's, not
   * the calendar's — the whole app runs Monday to Sunday off `plan_roll_dow`,
   * and a cheat meal that reset on a different boundary would let you have two
   * in four days without either of them looking like a second one.
   */
  const planWeek = useMemo(() => {
    if (!profile) return null;
    const dow = profile.plan_roll_dow ?? profile.shop_start_dow;
    return { from: lastRollDay(dow, day), to: addDays(nextRollDay(dow, day), -1), dow };
  }, [profile, day]);

  const weekCheat = useMemo(
    () => (planWeek ? cheatForWeek(cheats, planWeek.from, planWeek.to) : null),
    [cheats, planWeek]
  );
  const todayCheat = weekCheat && weekCheat.day === day ? weekCheat : null;

  /**
   * Worked out here rather than stored, on purpose.
   *
   * The answer depends on the plan, the day type and the targets, all of which
   * can move after the meal was entered. A stored absorption would go stale
   * silently; a recomputed one is always about the plan you actually have.
   */
  /**
   * Keyed on what the answer actually depends on, not on object identity.
   *
   * Absorbing a cheat meal runs the solver once, then again for every meal it
   * considers dropping — up to nine full fits. That is fine once; it is not
   * fine on every render, and every one of the dependencies here is a fresh
   * array or object after each fetch, so it was re-running for no reason and
   * locking the page while it did. The signature is the content that changes
   * the result, so the work happens once per real change.
   */
  const cheatKey = useMemo(() => {
    if (!todayCheat || !plan) return null;
    return JSON.stringify([
      todayCheat.day,
      todayCheat.meal_id,
      todayCheat.kcal,
      todayCheat.protein,
      todayCheat.carbs,
      todayCheat.fat,
      dayTypeId,
      day,
      meals.map((m) => [m.id, m.day_type_ids, m.times_per_day, m.ingredients.map((i) => i.grams)]),
    ]);
  }, [todayCheat, plan, dayTypeId, day, meals]);

  const absorption = useMemo(() => {
    if (!todayCheat || !plan || !profile) return null;
    return absorbCheat({
      cheat: todayCheat,
      meals: meals as any,
      plan,
      dayTypes,
      dayTypeId,
      supplements,
      rest: daysAfter(day, plan, planWeek?.dow ?? 1),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheatKey]);

  async function saveCheat(c: Omit<CheatMeal, "id">) {
    const saved = await fetch("/api/cheat", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    }).then((r) => r.json());
    setCheats((list) => [...list.filter((x) => x.day !== saved.day), saved]);
    setShowCheat(false);
  }

  async function clearCheat() {
    await fetch(`/api/cheat?day=${day}`, { method: "DELETE" });
    setCheats((list) => list.filter((x) => x.day !== day));
  }

  /**
   * The menu as the cheat meal leaves it.
   *
   * This is the part that has to be right. Working out that dinner comes off
   * and lunch shrinks is worth nothing if the list you tap through on the day
   * still shows the plan you are no longer eating — you would log the old one
   * out of habit and the day would be wrong by exactly the amount the whole
   * mechanism was there to handle.
   *
   * The cheat meal itself is in the list too, as an ordinary row carrying its
   * own macros. That way logging it is the same gesture as logging anything
   * else, and `eaten` adds up without knowing anything about cheat meals.
   */
  const menu = useMemo<Meal[]>(() => {
    if (!absorption || !todayCheat) return suggested;

    const byId = new Map(absorption.meals.map((m) => [m.mealId, m]));
    const kept: Meal[] = [];

    for (const m of suggested) {
      const o = byId.get(m.id);
      if (!o || o.action === "kept") {
        kept.push(m);
        continue;
      }
      if (o.action === "dropped" || o.action === "replaced") continue;

      const moved = new Map(o.portions.map((p) => [p.name, p.to]));
      kept.push({
        ...m,
        ingredients: m.ingredients.map((it) =>
          moved.has(it.name) ? { ...it, grams: moved.get(it.name) as number } : it
        ),
      });
    }

    // One synthetic row for the meal out. Grams of 100 with the macros stated
    // per 100 g means the existing arithmetic gives its real totals, with no
    // special case anywhere downstream.
    kept.push({
      id: -1,
      name: todayCheat.name,
      times_per_day: 1,
      day_type_ids: null,
      batch: false,
      ingredients: [
        {
          name: todayCheat.name,
          grams: 100,
          kcal_100: todayCheat.kcal,
          protein_100: todayCheat.protein,
          carbs_100: todayCheat.carbs,
          fat_100: todayCheat.fat,
        } as Item,
      ],
    });

    return kept;
  }, [absorption, todayCheat, suggested]);

  /**
   * What the times you logged actually say. Only meals with a time can be
   * placed, so this stays quiet until there are at least two of them.
   */
  const spacing = useMemo(
    () =>
      profile
        ? doseSpacing(
            entries.map((e) => ({
              name: e.meal_name,
              protein: totalFor(e.items).protein,
              at: e.at_time ?? null,
            })),
            planWeight(profile)
          )
        : null,
    [entries, profile]
  );

  /** Step a day back or forward; stop auto-rollover unless we're on today. */
  function go(delta: number) {
    setDay((d) => {
      const next = addDays(d, delta);
      setFollowToday(next === dayKey());
      return next;
    });
  }

  /**
   * A meal is logged at the portions in the plan — the same ones every day.
   * What makes a training day bigger is the extra meals on it, not a bigger
   * scoop of the same one.
   */
  function itemsFor(meal: Meal): Item[] {
    return meal.ingredients.map(stripItem);
  }

  /**
   * Log a meal at a time.
   *
   * Tapping the row logs it now, which is what you want nine times in ten;
   * the clock is there for the tenth, when you're catching up in the evening.
   * A day you're browsing back to has no "now" worth recording, so it goes in
   * without a time rather than stamping it with the time you happened to
   * remember.
   */
  async function addMeal(meal: Meal, at?: string) {
    const res = await fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        day,
        meal_id: meal.id,
        meal_name: meal.name,
        day_type_id: dayTypeId,
        items: itemsFor(meal),
        at_time: day === dayKey() || at !== undefined ? at ?? null : null,
      }),
    });
    const created = await res.json();
    setEntries((e) => sortByTime([...e, created]));
  }

  /** Change the time a logged meal was eaten. */
  async function setEntryTime(entry: Entry, at: string) {
    const res = await fetch("/api/log", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: entry.id,
        items: entry.items,
        confirmed: entry.confirmed,
        at_time: at,
      }),
    });
    const saved = await res.json();
    setEntries((list) => sortByTime(list.map((e) => (e.id === saved.id ? { ...saved } : e))));
  }

  async function saveEntry(entry: Entry, confirmed: boolean) {
    const res = await fetch("/api/log", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: entry.id, items: entry.items, confirmed }),
    });
    const saved = await res.json();
    setEntries((list) => sortByTime(list.map((e) => (e.id === saved.id ? { ...saved } : e))));
  }

  /** Today's supplements, and what they add to the day whether ticked or not. */
  async function setTaken(s: Supplement, taken: number) {
    setTakenMap((m) => new Map(m).set(s.id, taken));
    await fetch("/api/supplement-log", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        day,
        supplement_id: s.id,
        taken,
        at_time: taken > 0 ? nowClock() : null,
      }),
    });
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
      {/* Three tiles, so three columns — a 2-wide grid left fat stranded on a
          row of its own with a hole beside it. */}
      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        <MacroTile k="protein" eaten={eaten.protein} target={target.protein} />
        <MacroTile k="carbs" eaten={eaten.carbs} target={target.carbs} />
        <MacroTile k="fat" eaten={eaten.fat} target={target.fat} />
      </section>

      {/* The cheat meal. Below the macros because it is a thing that happens to
          a day rather than a thing you do every day, and above the meal list
          because what it does to that list is the point. */}
      {meals.length > 0 && (
        <CheatCard
          cheat={todayCheat}
          absorption={absorption}
          used={!!weekCheat && weekCheat.day !== day}
          onOpen={() => setShowCheat(true)}
          onClear={clearCheat}
        />
      )}

      {showCheat && (
        <CheatSheet
          day={day}
          meals={suggested as any}
          existing={todayCheat}
          onClose={() => setShowCheat(false)}
          onSave={saveCheat}
        />
      )}

      {/* Add a meal */}
      {meals.length === 0 ? (
        <section className="card px-5 py-10 text-center">
          <p className="text-sm text-[var(--color-mut)]">No meals in your plan yet.</p>
          <Link href="/plan" className="btn btn-accent mt-4">
            Build your plan
          </Link>
        </section>
      ) : (
        <section className="card px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-center gap-2">
            <p className="label mr-auto">Add a meal</p>
            {pending > 0 && (
              <button className="btn btn-sm btn-accent" onClick={confirmAll}>
                Confirm all {pending}
              </button>
            )}
          </div>

          {/* A list, not a wrapped row of pills. Full-width rows give a thumb
              something to aim at and leave room to say what each meal is. */}
          <div className="space-y-1.5">
            {menu.map((m) => {
              const t = totalFor(itemsFor(m));
              const used = entries.filter((e) => e.meal_id === m.id).length;
              const planned = Math.max(1, Number(m.times_per_day ?? 1));
              const done = used >= planned;
              const open = timeFor === m.id;

              return (
                <div key={m.id} className="sunk overflow-hidden">
                  <div className="flex items-stretch">
                    <button
                      onClick={() => addMeal(m, nowClock())}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left transition hover:bg-[#161a1f]"
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg font-light leading-none"
                        style={
                          done
                            ? { background: "var(--color-accent)", color: "#10160a" }
                            : { background: "var(--color-raised)", color: "var(--color-accent)" }
                        }
                      >
                        {done ? "✓" : "+"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {m.name}
                          {/* On the name line, not the macro line: that one is
                              already four numbers wide and truncates on a
                              phone, which turned "out of the fridge" into
                              "out of the f…". */}
                          {(m.batch || hasPrepped(m as any)) && (
                            <span className="ml-1.5 text-[0.68rem] font-medium text-[#5b6270]">
                              cooked ahead
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs tabular-nums text-[var(--color-mut)]">
                          {Math.round(t.kcal)} kcal · {Math.round(t.protein)}P{" "}
                          {Math.round(t.carbs)}C {Math.round(t.fat)}F
                          {m.batch ? ` · weigh ${Math.round(servingGrams(m as any))} g` : ""}
                        </span>
                      </span>
                      {used > 0 && (
                        <span className="num shrink-0 text-xs text-[var(--color-mut)]">
                          {used}/{planned}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setTimeFor(open ? null : m.id);
                        setPickTime(nowClock());
                      }}
                      aria-label={`Add ${m.name} at a specific time`}
                      aria-expanded={open}
                      title="Had it earlier? Pick the time"
                      className="shrink-0 border-l border-[#1c1f25] px-3.5 transition hover:bg-[#161a1f]"
                      style={{ color: open ? "var(--color-accent)" : "#545b68" }}
                    >
                      <ClockIcon />
                    </button>
                  </div>

                  {/* Had it earlier — pick the time before it goes in. */}
                  {open && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-[#1c1f25] px-3.5 py-3">
                      <span className="text-xs text-[var(--color-mut)]">Had it at</span>
                      <input
                        type="time"
                        className="field w-28 py-1.5"
                        aria-label="Time you ate it"
                        value={pickTime}
                        onChange={(e) => setPickTime(e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-accent ml-auto"
                        onClick={() => {
                          addMeal(m, pickTime);
                          setTimeFor(null);
                        }}
                      >
                        Add
                      </button>
                      <button className="btn btn-sm btn-quiet" onClick={() => setTimeFor(null)}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
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

      {/* Supplements */}
      {todaysSupps.length > 0 && (
        <section className="card px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-baseline">
            <p className="label mr-auto">Supplements</p>
            <p className="text-xs text-[var(--color-mut)]">
              {todaysSupps.filter((s) => (takenMap.get(s.id) ?? 0) >= suppReps(s)).length} of{" "}
              {todaysSupps.length} taken
            </p>
          </div>

          <div className="space-y-1.5">
            {todaysSupps.map((s) => {
              const reps = suppReps(s);
              const taken = takenMap.get(s.id) ?? 0;
              const done = taken >= reps;
              const spec = specFor(s.name);
              return (
                <div key={s.id} className="sunk flex items-center gap-3 px-3.5 py-3">
                  <button
                    className="tick"
                    data-on={done}
                    aria-pressed={done}
                    aria-label={`${done ? "Untake" : "Take"} ${s.name}`}
                    // Taken twice a day? Each tap counts one more, then resets.
                    onClick={() => setTaken(s, done ? 0 : taken + 1)}
                  >
                    {done ? "✓" : taken > 0 ? taken : ""}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-[var(--color-mut)]">
                      {doseLabel(s)}
                      {reps > 1 && ` · ${reps}× a day`}
                      {` · ${TIMING_LABEL[s.timing].toLowerCase()}`}
                      {s.kcal > 0 && ` · ${s.kcal} kcal`}
                    </span>
                  </span>
                  {spec && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: GRADE_COLOUR[spec.grade] }}
                      title={`${spec.name}: ${spec.what}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* What the times say */}
      {spacing && spacing.timed.length >= 2 && spacing.notes.length > 0 && (
        <section className="card px-5 py-4">
          <p className="label">How the day was spread</p>
          <ul className="mt-2 space-y-1.5">
            {spacing.notes.map((n, i) => (
              <li key={i} className="text-xs leading-relaxed text-[var(--color-mut)]">
                {n}
              </li>
            ))}
          </ul>
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
                    <div className="flex items-baseline gap-2">
                      <p className="truncate font-semibold">{e.meal_name}</p>
                      {/* The time is editable in place: getting it wrong by an
                          hour is common and re-logging the meal to fix it is
                          not a reasonable thing to ask. */}
                      <input
                        type="time"
                        aria-label={`Time you ate ${e.meal_name}`}
                        className="field-bare num shrink-0 rounded-md border px-1 py-0.5 text-xs text-[var(--color-mut)]"
                        value={e.at_time ?? ""}
                        onChange={(ev) => ev.target.value && setEntryTime(e, ev.target.value)}
                      />
                    </div>
                    <div className="mt-1">
                      <MacroChips m={t} />
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
                          <NumberField
                            className="w-[4.5rem] py-1.5 text-right text-sm"
                            value={it.grams}
                            onCommit={(v) => setGrams(e.id, i, v ?? 0)}
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
  };
}

/** The clock right now, as the time input wants it. */
function nowClock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The day's log in the order it happened.
 *
 * Anything logged before meal times existed has no time, and goes last rather
 * than pretending to be midnight — an untimed meal at the top of the list
 * would misrepresent the day every bit as much as a wrong time would.
 */
function sortByTime<T extends { at_time?: string | null; id: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.at_time && b.at_time) return a.at_time.localeCompare(b.at_time) || a.id - b.id;
    if (a.at_time) return -1;
    if (b.at_time) return 1;
    return a.id - b.id;
  });
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function prettyDay(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
