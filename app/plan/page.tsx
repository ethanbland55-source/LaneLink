"use client";

import { useEffect, useMemo, useState } from "react";
import { RecalculateDialog } from "../recalculate";
import { Bar, MACRO_COLOR, MACRO_LABEL, type MacroKey } from "../macro-ui";
import { offTarget, type BoundedItem } from "@/lib/optimise";
import {
  ACTIVITY_LEVELS,
  GOALS,
  ageFromDob,
  itemMacros,
  sumMacros,
  targets,
  totalFor,
  type Goal,
  type Profile,
} from "@/lib/nutrition";

type Meal = { id: number; name: string; ingredients: BoundedItem[] };

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
};

export default function PlanPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecalc, setShowRecalc] = useState(false);

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

  const target = useMemo(() => (profile ? targets(profile) : null), [profile]);
  const planTotal = useMemo(() => sumMacros(meals.map((m) => totalFor(m.ingredients))), [meals]);
  const drift = useMemo(() => (target ? offTarget(planTotal, target) : null), [planTotal, target]);

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

  async function applyRecalc(next: Meal[]) {
    for (const m of next) await persist(m);
    setMeals(next);
    setShowRecalc(false);
    flash("Portions rebalanced");
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

  if (loading || !profile || !target) {
    return <p className="py-24 text-center text-sm text-[var(--color-mut)]">Loading…</p>;
  }

  const diff = Math.round(planTotal.kcal - target.kcal);

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
          target={target}
          onClose={() => setShowRecalc(false)}
          onApply={applyRecalc}
        />
      )}

      {/* Target vs plan */}
      <section className="card px-5 py-6">
        <div className="flex items-start">
          <div className="mr-auto">
            <p className="label">Daily target</p>
            <p className="num mt-2 text-[3.5rem] sm:text-[4rem]">
              {target.kcal.toLocaleString()}
            </p>
          </div>
          <div className="pt-1 text-right">
            <p className="label">Your plan</p>
            <p className="num mt-2 text-2xl">{Math.round(planTotal.kcal).toLocaleString()}</p>
            <p
              className="mt-1 text-sm font-bold tabular-nums"
              style={{ color: drift ? "var(--color-carbs)" : "var(--color-accent)" }}
            >
              {diff >= 0 ? "+" : ""}
              {diff}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {(["kcal", "protein", "carbs", "fat"] as MacroKey[]).map((k) => (
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

        <button
          className={`${drift ? "btn btn-accent" : "btn"} mt-6 w-full`}
          onClick={() => setShowRecalc(true)}
          disabled={meals.length === 0}
        >
          Recalculate portions
        </button>
      </section>

      {/* Meals */}
      {meals.map((meal) => {
        const t = totalFor(meal.ingredients);
        return (
          <section key={meal.id} className="card px-4 py-4 sm:px-5">
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

            <div className="mt-3 space-y-2">
              {meal.ingredients.map((it, i) => {
                const m = itemMacros(it);
                return (
                  <div key={i} className="sunk px-3 py-2.5">
                    {/* Line 1: what it is, and how much of it */}
                    <div className="flex items-center gap-2">
                      <input
                        className="field field-bare mr-auto w-full min-w-0 flex-1 px-1.5 py-1 text-sm font-semibold"
                        placeholder="Ingredient"
                        value={it.name}
                        onChange={(e) => patchItem(meal.id, i, { name: e.target.value })}
                      />
                      <span className="num text-sm text-[var(--color-mut)]">
                        {Math.round(m.kcal)} kcal
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        className="field w-[4.5rem] py-1.5 text-right text-sm font-bold"
                        value={it.grams}
                        onChange={(e) => patchItem(meal.id, i, { grams: Number(e.target.value) })}
                      />
                      <span className="w-2 text-xs text-[var(--color-mut)]">g</span>
                      <button
                        className="px-1 text-[#4a505c] transition hover:text-[var(--color-fat)]"
                        title="Remove"
                        onClick={() =>
                          patchMeal(meal.id, {
                            ingredients: meal.ingredients.filter((_, j) => j !== i),
                          })
                        }
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
                            value={it[key]}
                            onChange={(e) =>
                              patchItem(meal.id, i, {
                                [key]: Number(e.target.value),
                              } as Partial<BoundedItem>)
                            }
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

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

      <button className="btn w-full" onClick={addMeal}>
        + Add meal
      </button>

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
            <Field label="Activity">
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

          <div className="sm:col-span-2">
            <Field label="Goal">
              <div className="grid grid-cols-3 gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => set("goal", g.value as Goal)}
                    className={profile.goal === g.value ? "btn btn-accent" : "btn"}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Protein g/kg">
            <Num
              value={profile.protein_per_kg}
              onChange={(v) => set("protein_per_kg", v)}
              step={0.1}
            />
          </Field>

          <Field label="Fat g/kg">
            <Num value={profile.fat_per_kg} onChange={(v) => set("fat_per_kg", v)} step={0.05} />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Manual kcal override">
              <input
                type="number"
                className="field w-full"
                value={profile.calorie_override ?? ""}
                placeholder={`${target.kcal} — calculated`}
                onChange={(e) =>
                  set("calorie_override", e.target.value ? Number(e.target.value) : null)
                }
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="BMR" value={target.bmr} />
          <Stat label="Maintenance" value={target.maintenance} />
          <Stat label="Target" value={target.kcal} accent />
        </div>

        <button className="btn btn-accent mt-4 w-full" onClick={saveProfile}>
          Save targets
        </button>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="sunk px-3 py-3">
      <p className="label">{label}</p>
      <p
        className="num mt-1.5 text-xl"
        style={accent ? { color: "var(--color-accent)" } : undefined}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
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
