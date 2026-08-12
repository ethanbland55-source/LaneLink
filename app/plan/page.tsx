"use client";

import { useEffect, useMemo, useState } from "react";
import { RecalculateDialog } from "../recalculate";
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
  type Item,
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
  const drift = useMemo(
    () => (target ? offTarget(planTotal, target) : null),
    [planTotal, target]
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

  async function persist(meal: Meal) {
    await fetch("/api/meals", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(meal),
    });
  }

  async function saveMeal(meal: Meal) {
    await persist(meal);
    flash(`“${meal.name}” saved`);
  }

  async function applyRecalc(next: Meal[]) {
    for (const m of next) await persist(m);
    setMeals(next);
    setShowRecalc(false);
    flash("Portions rebalanced and saved");
  }

  async function deleteMeal(id: number) {
    if (!confirm("Delete this meal from your plan?")) return;
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
    setTimeout(() => setSaved(null), 2200);
  }

  if (loading || !profile || !target) {
    return <p className="py-20 text-center text-[#8a97ae]">Loading…</p>;
  }

  return (
    <div className="space-y-6 pb-16">
      {saved && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#38e2b0] px-5 py-2 text-sm font-semibold text-[#04120d] shadow-xl">
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

      {/* ---------- Daily target + recalculate ---------- */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <div>
            <p className="label">Daily target</p>
            <p className="mt-1 text-3xl font-black leading-none tracking-tight">
              {target.kcal.toLocaleString()}
              <span className="ml-1 text-base font-semibold text-[#8a97ae]">kcal</span>
            </p>
          </div>

          <div className="hidden h-10 w-px bg-[#1e2637] sm:block" />

          <div>
            <p className="label">Your plan adds up to</p>
            <p className="mt-1 text-3xl font-black leading-none tracking-tight">
              {Math.round(planTotal.kcal).toLocaleString()}
              <span
                className="ml-2 text-sm font-bold"
                style={{ color: drift ? "var(--color-carbs)" : "var(--color-accent)" }}
              >
                {planTotal.kcal >= target.kcal ? "+" : ""}
                {Math.round(planTotal.kcal - target.kcal)}
              </span>
            </p>
          </div>

          <button
            className={drift ? "btn btn-accent ml-auto" : "btn ml-auto"}
            onClick={() => setShowRecalc(true)}
            disabled={meals.length === 0}
          >
            ⟳ Recalculate portions
          </button>
        </div>

        {/* Four slim target-vs-plan bars */}
        <div className="grid gap-x-6 gap-y-2 border-t border-[#1e2637] px-5 py-3 sm:grid-cols-2">
          {(["protein", "carbs", "fat", "kcal"] as const).map((k) => (
            <TargetBar key={k} k={k} plan={planTotal[k]} target={target[k]} />
          ))}
        </div>

        {drift && (
          <p className="border-t border-[#1e2637] bg-[#ffb547]/[0.07] px-5 py-2.5 text-xs text-[#ffd08a]">
            Off target on {drift.join(", ")} by enough to change your results. Hit{" "}
            <b>Recalculate portions</b> to fix the gram amounts.
          </p>
        )}
      </section>

      {/* ---------- Your numbers ---------- */}
      <section className="panel px-5 py-5">
        <h2 className="text-lg font-bold tracking-tight">Your numbers</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#8a97ae]">
          Mifflin-St Jeor BMR × activity (the same maths as calculator.net), adjusted for your
          goal. Protein is fixed per kg, fat is set per kg, and carbs take whatever calories are
          left.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

          <Field label={`Date of birth · age ${ageFromDob(profile.dob)}`}>
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

          <Field label="Current weight (kg)">
            <Num value={profile.weight_kg} onChange={(v) => set("weight_kg", v)} step={0.1} />
          </Field>

          <Field label="Activity level">
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

          <Field label="Goal">
            <div className="grid grid-cols-3 gap-1.5">
              {GOALS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => set("goal", g.value as Goal)}
                  className="btn px-1"
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

          <Field label="Protein g/kg · keep at 2.0">
            <Num
              value={profile.protein_per_kg}
              onChange={(v) => set("protein_per_kg", v)}
              step={0.1}
            />
          </Field>

          <Field label="Fat g/kg · 0.6 to 0.8">
            <Num value={profile.fat_per_kg} onChange={(v) => set("fat_per_kg", v)} step={0.05} />
          </Field>

          <Field label="Manual kcal override">
            <input
              type="number"
              className="field w-full"
              value={profile.calorie_override ?? ""}
              placeholder={`${target.kcal} (calculated)`}
              onChange={(e) =>
                set("calorie_override", e.target.value ? Number(e.target.value) : null)
              }
            />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#1e2637] pt-4">
          <div className="mr-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Stat label="BMR" value={target.bmr} />
            <Stat label="Maintenance" value={target.maintenance} />
            <Stat label="Target" value={target.kcal} accent />
          </div>
          <button className="btn btn-accent" onClick={saveProfile}>
            Save targets
          </button>
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
            <div key={meal.id} className="panel px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field mr-auto w-full max-w-[15rem] text-base font-semibold"
                  value={meal.name}
                  onChange={(e) => patchMeal(meal.id, { name: e.target.value })}
                />
                <span className="hidden text-xs text-[#8a97ae] sm:inline">
                  {Math.round(t.kcal)} kcal · P {t.protein.toFixed(0)} · C {t.carbs.toFixed(0)} · F{" "}
                  {t.fat.toFixed(0)}
                </span>
                <button
                  className="btn btn-ghost text-[#8a97ae] hover:text-[#ff6f91]"
                  onClick={() => deleteMeal(meal.id)}
                >
                  Delete
                </button>
                <button className="btn btn-accent" onClick={() => saveMeal(meal)}>
                  Save
                </button>
              </div>

              <div className="mt-3 -mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[600px] border-separate border-spacing-y-1 text-sm">
                  <thead>
                    <tr>
                      <th className="label pb-1 text-left font-semibold">Ingredient</th>
                      <th className="label pb-1 text-right font-semibold">Grams</th>
                      <th className="label pb-1 text-center font-semibold" colSpan={4}>
                        per 100 g — kcal / P / C / F
                      </th>
                      <th className="label pb-1 text-right font-semibold">In this portion</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {meal.ingredients.map((it, i) => {
                      const m = itemMacros(it);
                      return (
                        <tr key={i} className="group">
                          <td className="pr-2">
                            <input
                              className="field w-full"
                              placeholder="Chicken breast"
                              value={it.name}
                              onChange={(e) => patchItem(meal.id, i, { name: e.target.value })}
                            />
                          </td>
                          <td className="pr-3">
                            <input
                              type="number"
                              inputMode="decimal"
                              className="field w-[4.5rem] text-right font-semibold"
                              style={{ borderColor: "#2b3a52" }}
                              value={it.grams}
                              onChange={(e) =>
                                patchItem(meal.id, i, { grams: Number(e.target.value) })
                              }
                            />
                          </td>
                          {(["kcal_100", "protein_100", "carbs_100", "fat_100"] as const).map(
                            (k) => (
                              <td key={k} className="pr-1.5">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  className="field w-[3.9rem] px-2 text-right text-[0.8rem]"
                                  value={it[k]}
                                  onChange={(e) =>
                                    patchItem(meal.id, i, {
                                      [k]: Number(e.target.value),
                                    } as Partial<BoundedItem>)
                                  }
                                />
                              </td>
                            )
                          )}
                          <td className="whitespace-nowrap pl-2 pr-1 text-right text-[0.72rem] leading-tight text-[#8a97ae]">
                            <b className="text-[#eef2f8]">{Math.round(m.kcal)}</b> kcal
                            <br />
                            {m.protein.toFixed(1)}P · {m.carbs.toFixed(1)}C · {m.fat.toFixed(1)}F
                          </td>
                          <td className="pl-1">
                            <button
                              className="px-1 text-[#3d4759] hover:text-[#ff6f91]"
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

              <button
                className="btn mt-2"
                onClick={() =>
                  patchMeal(meal.id, { ingredients: [...meal.ingredients, { ...BLANK }] })
                }
              >
                + Ingredient
              </button>
            </div>
          );
        })}

        {meals.length === 0 && (
          <div className="panel px-4 py-10 text-center text-sm text-[#8a97ae]">
            No meals yet. Add your first one above — name it (Breakfast, Pre-swim, Dinner…), then
            list each ingredient with its weight and the per-100g macros off the packet.
          </div>
        )}
      </section>
    </div>
  );
}

/** Slim plan-vs-target bar for one macro. */
function TargetBar({
  k,
  plan,
  target,
}: {
  k: "kcal" | "protein" | "carbs" | "fat";
  plan: number;
  target: number;
}) {
  const colors = {
    kcal: "var(--color-accent)",
    protein: "var(--color-protein)",
    carbs: "var(--color-carbs)",
    fat: "var(--color-fat)",
  };
  const labels = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat" };
  const unit = k === "kcal" ? "" : "g";
  const pct = target > 0 ? Math.min(140, (plan / target) * 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-[0.7rem] font-semibold text-[#8a97ae]">{labels[k]}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#161d2c]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, pct)}%`, background: colors[k] }}
        />
        {/* the 100% marker */}
        <div className="absolute inset-y-0 right-0 w-px bg-white/25" />
      </div>
      <span className="w-[6.5rem] shrink-0 text-right text-[0.72rem] tabular-nums text-[#8a97ae]">
        <b className="text-[#eef2f8]">
          {Math.round(plan)}
          {unit}
        </b>{" "}
        / {Math.round(target)}
        {unit}
      </span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <span>
      <span className="text-[#8a97ae]">{label} </span>
      <b style={accent ? { color: "var(--color-accent)" } : undefined}>{value.toLocaleString()}</b>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
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
