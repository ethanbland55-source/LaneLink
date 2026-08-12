"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, MacroChips, MacroTile } from "./macro-ui";
import {
  dayKey,
  itemMacros,
  sumMacros,
  targets,
  totalFor,
  type Item,
  type Macros,
  type Profile,
} from "@/lib/nutrition";

type Meal = { id: number; name: string; ingredients: Item[] };
type Entry = {
  id: number;
  meal_id: number | null;
  meal_name: string;
  confirmed: boolean;
  items: Item[];
};

const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export default function TodayPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [day, setDay] = useState(dayKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    try {
      const [p, m, l] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
        fetch(`/api/log?day=${d}`).then((r) => r.json()),
      ]);
      setProfile(normalise(p));
      setMeals(m);
      setEntries(l);
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

  // The logging day turns over at 03:00; catch it without a refresh.
  useEffect(() => {
    const t = setInterval(() => {
      const k = dayKey();
      setDay((prev) => (k !== prev ? k : prev));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const target = useMemo(
    () => (profile ? targets(profile) : { ...ZERO, maintenance: 0, bmr: 0 }),
    [profile]
  );

  const eaten = useMemo(
    () => sumMacros(entries.filter((e) => e.confirmed).map((e) => totalFor(e.items))),
    [entries]
  );

  async function addMeal(meal: Meal) {
    const res = await fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        day,
        meal_id: meal.id,
        meal_name: meal.name,
        items: meal.ingredients.map(stripItem),
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

  const left = Math.round(target.kcal - eaten.kcal);
  const over = left < 0;

  return (
    <div className="space-y-3">
      {error && (
        <div className="card px-5 py-3 text-sm text-[var(--color-fat)]">{error}</div>
      )}

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
          <p className="pt-1 text-right text-xs leading-relaxed text-[var(--color-mut)]">
            {prettyDay(day)}
            <br />
            {Math.round(eaten.kcal).toLocaleString()} of {target.kcal.toLocaleString()} kcal
          </p>
        </div>

        <div className="mt-5">
          <Bar value={eaten.kcal} target={target.kcal} color="var(--color-accent)" height={8} />
        </div>
      </section>

      {/* Macros */}
      <section className="grid grid-cols-3 gap-3">
        <MacroTile k="protein" eaten={eaten.protein} target={target.protein} />
        <MacroTile k="carbs" eaten={eaten.carbs} target={target.carbs} />
        <MacroTile k="fat" eaten={eaten.fat} target={target.fat} />
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
          <p className="label mb-3">Add a meal</p>
          <div className="flex flex-wrap gap-2">
            {meals.map((m) => {
              const t = totalFor(m.ingredients);
              const used = entries.filter((e) => e.meal_id === m.id).length;
              return (
                <button
                  key={m.id}
                  onClick={() => addMeal(m)}
                  className="sunk group flex items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[#161a1f]"
                >
                  <span className="text-lg font-light leading-none text-[var(--color-accent)]">
                    +
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{m.name}</span>
                    <span className="block text-xs tabular-nums text-[var(--color-mut)]">
                      {Math.round(t.kcal)} kcal
                    </span>
                  </span>
                  {used > 0 && (
                    <span className="num ml-1 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[0.65rem] text-[#10160a]">
                      {used}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Today's log */}
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
  };
}

function normalise(p: any): Profile {
  return {
    sex: p?.sex ?? "male",
    dob: p?.dob ? String(p.dob).slice(0, 10) : null,
    height_cm: Number(p?.height_cm ?? 180),
    weight_kg: Number(p?.weight_kg ?? 75),
    activity: Number(p?.activity ?? 1.725),
    goal: p?.goal ?? "cut",
    protein_per_kg: Number(p?.protein_per_kg ?? 2),
    fat_per_kg: Number(p?.fat_per_kg ?? 0.7),
    calorie_override: p?.calorie_override ? Number(p.calorie_override) : null,
  };
}

function prettyDay(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
