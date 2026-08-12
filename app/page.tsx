"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MacroChips, MacroRow } from "./macro-ui";
import {
  DAY_ROLLOVER_HOUR,
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
      setError("Couldn't reach the database. Check DATABASE_URL in Vercel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(day);
  }, [day, load]);

  // Roll the day over at 03:00 without needing a refresh.
  useEffect(() => {
    const t = setInterval(() => {
      const k = dayKey();
      setDay((prev) => (k !== prev ? k : prev));
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const target = useMemo(() => (profile ? targets(profile) : { ...ZERO, maintenance: 0, bmr: 0 }), [profile]);

  const eaten = useMemo(
    () => sumMacros(entries.filter((e) => e.confirmed).map((e) => totalFor(e.items))),
    [entries]
  );

  const planTotal = useMemo(
    () => sumMacros(meals.map((m) => totalFor(m.ingredients))),
    [meals]
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

  if (loading) return <p className="py-20 text-center text-[#8a97ae]">Loading…</p>;

  return (
    <div className="space-y-5">
      {error && (
        <div className="panel border-[#ff6f91]/40 px-4 py-3 text-sm text-[#ff9db3]">{error}</div>
      )}

      {/* Header bar — the daily targets from your plan / calculator */}
      <header className="panel px-4 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label">Daily target · {goalLabel(profile)}</p>
            <p className="mt-0.5 text-3xl font-black tracking-tight">
              {target.kcal.toLocaleString()}{" "}
              <span className="text-base font-semibold text-[#8a97ae]">kcal</span>
            </p>
            <p className="mt-1 text-xs text-[#8a97ae]">
              BMR {target.bmr} · maintenance {target.maintenance} · P {target.protein}g · C{" "}
              {target.carbs}g · F {target.fat}g
            </p>
          </div>
          <div className="text-right text-xs text-[#8a97ae]">
            <p className="font-semibold text-[#eef2f8]">{prettyDay(day)}</p>
            <p>resets at {String(DAY_ROLLOVER_HOUR).padStart(2, "0")}:00</p>
            {meals.length > 0 && (
              <p className="mt-1">Plan as written: {Math.round(planTotal.kcal)} kcal</p>
            )}
          </div>
        </div>
      </header>

      {/* The live counter */}
      <MacroRow eaten={eaten} target={target} />

      {/* Meal tabs */}
      <section>
        <p className="label mb-2">Add a meal</p>
        {meals.length === 0 ? (
          <div className="panel px-4 py-6 text-center text-sm text-[#8a97ae]">
            No meals yet —{" "}
            <Link href="/plan" className="text-[#38e2b0] underline">
              build your plan
            </Link>{" "}
            first.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {meals.map((m) => {
              const t = totalFor(m.ingredients);
              const used = entries.filter((e) => e.meal_id === m.id).length;
              return (
                <button
                  key={m.id}
                  onClick={() => addMeal(m)}
                  className="panel group flex items-center gap-3 px-3 py-2 text-left hover:border-[#38e2b0]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-[#38e2b0] text-sm font-bold text-[#04120d]">
                    +
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">
                      {m.name}
                      {used > 0 && <span className="ml-1 text-[#38e2b0]">×{used}</span>}
                    </span>
                    <span className="block text-[0.7rem] text-[#8a97ae]">
                      {Math.round(t.kcal)} kcal · P {Math.round(t.protein)} · C{" "}
                      {Math.round(t.carbs)} · F {Math.round(t.fat)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Today's log */}
      <section className="space-y-3">
        <p className="label">Eaten today</p>
        {entries.length === 0 && (
          <div className="panel px-4 py-6 text-center text-sm text-[#8a97ae]">
            Nothing logged yet.
          </div>
        )}
        {entries.map((e) => {
          const t = totalFor(e.items);
          return (
            <div
              key={e.id}
              className="panel px-4 py-3"
              style={e.confirmed ? { borderColor: "rgba(56,226,176,0.45)" } : undefined}
            >
              <div className="flex items-center gap-2">
                <p className="mr-auto font-semibold">
                  {e.meal_name}
                  {e.confirmed && <span className="ml-2 text-xs text-[#38e2b0]">✓ confirmed</span>}
                </p>
                <button className="btn btn-ghost text-[#8a97ae]" onClick={() => removeEntry(e.id)}>
                  Remove
                </button>
                <button
                  className={e.confirmed ? "btn" : "btn btn-accent"}
                  onClick={() => saveEntry(e, !e.confirmed)}
                >
                  {e.confirmed ? "Edit" : "Confirm"}
                </button>
              </div>

              <div className="mt-3 space-y-1.5">
                {e.items.map((it, i) => {
                  const m = itemMacros(it);
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="mr-auto truncate">{it.name}</span>
                      <span className="hidden text-[0.7rem] text-[#8a97ae] sm:inline">
                        {Math.round(m.kcal)} kcal · P {m.protein.toFixed(1)} · C{" "}
                        {m.carbs.toFixed(1)} · F {m.fat.toFixed(1)}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        disabled={e.confirmed}
                        className="field w-20 text-right disabled:opacity-50"
                        value={it.grams}
                        onChange={(ev) => setGrams(e.id, i, Number(ev.target.value))}
                      />
                      <span className="w-3 text-xs text-[#8a97ae]">g</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-[#1e2637] pt-2">
                <MacroChips m={t} />
                {!e.confirmed && (
                  <button className="btn btn-ghost text-xs" onClick={() => saveEntry(e, false)}>
                    Save amounts
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
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

function goalLabel(p: Profile | null) {
  if (!p) return "—";
  return { cut: "Cutting", maintain: "Maintaining", bulk: "Bulking" }[p.goal];
}

function prettyDay(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}
