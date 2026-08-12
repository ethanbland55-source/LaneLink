"use client";

import { useEffect, useMemo, useState } from "react";
import { MacroChips } from "../macro-ui";
import {
  ACTIVITY_LEVELS,
  GOALS,
  ageFromDob,
  itemMacros,
  sumMacros,
  targets,
  totalFor,
  type Goal,
  type Item,
  type Profile,
} from "@/lib/nutrition";

type Meal = { id: number; name: string; ingredients: Item[] };

const BLANK: Item = {
  name: "",
  grams: 100,
  kcal_100: 0,
  protein_100: 0,
  carbs_100: 0,
  fat_100: 0,
};

export default function PlanPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [p, m] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
      ]);
      setProfile(normalise(p));
      setMeals(m);
      setLoading(false);
    })();
  }, []);

  const target = useMemo(
    () => (profile ? targets(profile) : null),
    [profile]
  );
  const planTotal = useMemo(
    () => sumMacros(meals.map((m) => totalFor(m.ingredients))),
    [meals]
  );

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setProfile((p) => (p ? { ...p, [k]: v } : p));
  }

  async function saveProfile() {
    if (!profile) return;
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    flash("Targets saved");
  }

  async function addMeal() {
    const res = await fetch("/api/meals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Meal ${meals.length + 1}` }),
    });
    const created = await res.json();
    setMeals((m) => [...m, created]);
  }

  async function saveMeal(meal: Meal) {
    await fetch("/api/meals", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(meal),
    });
    flash(`“${meal.name}” saved`);
  }

  async function deleteMeal(id: number) {
    if (!confirm("Delete this meal from your plan?")) return;
    await fetch(`/api/meals?id=${id}`, { method: "DELETE" });
    setMeals((m) => m.filter((x) => x.id !== id));
  }

  function patchMeal(id: number, patch: Partial<Meal>) {
    setMeals((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function patchItem(mealId: number, idx: number, patch: Partial<Item>) {
    setMeals((list) =>
      list.map((m) =>
        m.id !== mealId
          ? m
          : { ...m, ingredients: m.ingredients.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }
      )
    );
  }

  function flash(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2000);
  }

  if (loading || !profile || !target) {
    return <p className="py-20 text-center text-[#8a97ae]">Loading…</p>;
  }

  const diff = Math.round(planTotal.kcal - target.kcal);

  return (
    <div className="space-y-6 pb-16">
      {saved && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#38e2b0] px-4 py-2 text-sm font-semibold text-[#04120d] shadow-lg">
          {saved}
        </div>
      )}

      {/* ---------- Targets ---------- */}
      <section className="panel px-4 py-4">
        <h2 className="text-lg font-bold tracking-tight">Your numbers</h2>
        <p className="mt-1 text-xs text-[#8a97ae]">
          Calories come from Mifflin-St Jeor BMR × activity (the same maths as
          calculator.net), then adjusted for your goal. Protein is fixed per kg; fat is set per
          kg; carbs take whatever calories are left.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Sex">
            <select
              className="field"
              value={profile.sex}
              onChange={(e) => set("sex", e.target.value as Profile["sex"])}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>

          <Field label={`Date of birth (age ${ageFromDob(profile.dob)})`}>
            <input
              type="date"
              className="field"
              value={profile.dob ?? ""}
              onChange={(e) => set("dob", e.target.value || null)}
            />
          </Field>

          <Field label="Height (cm)">
            <Num value={profile.height_cm} onChange={(v) => set("height_cm", v)} />
          </Field>

          <Field label="Current weight (kg)">
            <Num value={profile.weight_kg} onChange={(v) => set("weight_kg", v)} step={0.1} />
          </Field>

          <Field label="Activity level">
            <select
              className="field"
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

          <Field label="Goal">
            <div className="grid grid-cols-3 gap-1.5">
              {GOALS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => set("goal", g.value as Goal)}
                  className="btn"
                  style={
                    profile.goal === g.value
                      ? { background: "#38e2b0", borderColor: "#38e2b0", color: "#04120d" }
                      : undefined
                  }
                >
                  {g.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Protein (g per kg) — keep at 2.0">
            <Num value={profile.protein_per_kg} onChange={(v) => set("protein_per_kg", v)} step={0.1} />
          </Field>

          <Field label="Fat (g per kg) — 0.6 to 0.8">
            <Num value={profile.fat_per_kg} onChange={(v) => set("fat_per_kg", v)} step={0.05} />
          </Field>

          <Field label="Manual kcal override (blank = calculated)">
            <input
              type="number"
              className="field"
              value={profile.calorie_override ?? ""}
              placeholder={String(target.kcal)}
              onChange={(e) =>
                set("calorie_override", e.target.value ? Number(e.target.value) : null)
              }
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#1e2637] pt-3">
          <div className="mr-auto text-sm">
            <span className="text-[#8a97ae]">BMR </span>
            <b>{target.bmr}</b>
            <span className="text-[#8a97ae]"> · maintenance </span>
            <b>{target.maintenance}</b>
            <span className="text-[#8a97ae]"> · target </span>
            <b className="text-[#38e2b0]">{target.kcal} kcal</b>
            <span className="text-[#8a97ae]">
              {" "}
              · P {target.protein}g · C {target.carbs}g · F {target.fat}g
            </span>
          </div>
          <button className="btn btn-accent" onClick={saveProfile}>
            Save targets
          </button>
        </div>
      </section>

      {/* ---------- Plan vs target ---------- */}
      <section className="panel px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="label">Meal plan total</p>
            <p className="mt-1 text-xl font-black tracking-tight">
              {Math.round(planTotal.kcal)} kcal{" "}
              <span
                className="text-sm font-semibold"
                style={{ color: Math.abs(diff) <= 75 ? "#38e2b0" : "#ffb547" }}
              >
                ({diff >= 0 ? "+" : ""}
                {diff} vs target)
              </span>
            </p>
          </div>
          <MacroChips m={planTotal} />
        </div>
      </section>

      {/* ---------- Meals ---------- */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-lg font-bold tracking-tight">Meals</h2>
          <button className="btn btn-accent" onClick={addMeal}>
            + Add meal
          </button>
        </div>

        {meals.map((meal) => {
          const t = totalFor(meal.ingredients);
          return (
            <div key={meal.id} className="panel px-4 py-4">
              <div className="flex items-center gap-2">
                <input
                  className="field mr-auto max-w-xs font-semibold"
                  value={meal.name}
                  onChange={(e) => patchMeal(meal.id, { name: e.target.value })}
                />
                <button className="btn btn-ghost text-[#ff6f91]" onClick={() => deleteMeal(meal.id)}>
                  Delete
                </button>
                <button className="btn btn-accent" onClick={() => saveMeal(meal)}>
                  Save meal
                </button>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="label pb-1">Ingredient</th>
                      <th className="label pb-1 w-20">Grams</th>
                      <th className="label pb-1 w-20">kcal/100g</th>
                      <th className="label pb-1 w-20">P/100g</th>
                      <th className="label pb-1 w-20">C/100g</th>
                      <th className="label pb-1 w-20">F/100g</th>
                      <th className="label pb-1 w-32">This amount</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {meal.ingredients.map((it, i) => {
                      const m = itemMacros(it);
                      return (
                        <tr key={i}>
                          <td className="py-1 pr-2">
                            <input
                              className="field"
                              placeholder="Chicken breast"
                              value={it.name}
                              onChange={(e) => patchItem(meal.id, i, { name: e.target.value })}
                            />
                          </td>
                          {(
                            ["grams", "kcal_100", "protein_100", "carbs_100", "fat_100"] as const
                          ).map((k) => (
                            <td key={k} className="py-1 pr-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                className="field text-right"
                                value={it[k]}
                                onChange={(e) =>
                                  patchItem(meal.id, i, { [k]: Number(e.target.value) } as Partial<Item>)
                                }
                              />
                            </td>
                          ))}
                          <td className="py-1 pr-2 text-[0.7rem] text-[#8a97ae]">
                            {Math.round(m.kcal)} kcal · {m.protein.toFixed(1)}P ·{" "}
                            {m.carbs.toFixed(1)}C · {m.fat.toFixed(1)}F
                          </td>
                          <td>
                            <button
                              className="text-[#8a97ae] hover:text-[#ff6f91]"
                              title="Remove ingredient"
                              onClick={() =>
                                patchMeal(meal.id, {
                                  ingredients: meal.ingredients.filter((_, j) => j !== i),
                                })
                              }
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#1e2637] pt-3">
                <button
                  className="btn"
                  onClick={() =>
                    patchMeal(meal.id, { ingredients: [...meal.ingredients, { ...BLANK }] })
                  }
                >
                  + Ingredient
                </button>
                <div className="ml-auto">
                  <MacroChips m={t} />
                </div>
              </div>
            </div>
          );
        })}

        {meals.length === 0 && (
          <div className="panel px-4 py-8 text-center text-sm text-[#8a97ae]">
            No meals yet. Add your first one above — name it (Breakfast, Pre-swim, Dinner…), then
            list each ingredient with its weight and the per-100g macros off the packet.
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
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
      className="field"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
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
