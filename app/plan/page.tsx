"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RecalculateDialog } from "../recalculate";
import { Bar, MACRO_COLOR, MACRO_LABEL, Segmented, Stat, type MacroKey } from "../macro-ui";
import { offTarget, type BoundedItem } from "@/lib/optimise";
import { dayVolume, volumeHeadline } from "@/lib/prep";
import { profileFor } from "@/lib/foods";
import {
  ACTIVITY_LEVELS,
  DAY_TYPES,
  GOALS,
  METS,
  WEEKDAYS,
  WEEKDAY_LABEL,
  ageFromDob,
  itemMacros,
  macroConsistency,
  sessionKcal,
  sumMacros,
  targets,
  totalFor,
  type DayType,
  type Goal,
  type Profile,
  type Weekday,
} from "@/lib/nutrition";
import { DOW_LABELS, SHOP_DAY_OPTIONS, normaliseProfile } from "@/lib/profile";

type Meal = {
  id: number;
  name: string;
  times_per_day: number;
  day_types: DayType[] | null;
  ingredients: BoundedItem[];
};

const BLANK: BoundedItem = {
  name: "",
  grams: 100,
  kcal_100: 0,
  protein_100: 0,
  carbs_100: 0,
  fat_100: 0,
  fibre_100: 0,
  min_grams: null,
  max_grams: null,
  locked: false,
};

const BAR_KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat", "fibre"];

export default function PlanPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRecalc, setShowRecalc] = useState(false);
  const [planFor, setPlanFor] = useState<DayType>("session");
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, m] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/meals").then((r) => r.json()),
      ]);
      const prof = normaliseProfile(p);
      setProfile(prof);
      setMeals(
        (m as any[]).map((x) => ({
          ...x,
          times_per_day: Number(x.times_per_day ?? 1),
          day_types: x.day_types ?? null,
        }))
      );
      setLoading(false);
    })();
  }, []);

  const target = useMemo(
    () => (profile ? targets(profile, profile.cycling ? planFor : "session") : null),
    [profile, planFor]
  );

  /** The plan as eaten on this kind of day: meals that apply, times each. */
  const activeMeals = useMemo(
    () =>
      meals.filter(
        (m) =>
          !profile?.cycling ||
          !m.day_types ||
          m.day_types.length === 0 ||
          m.day_types.includes(planFor)
      ),
    [meals, profile, planFor]
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
  const volume = useMemo(() => dayVolume(activeMeals), [activeMeals]);

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setProfile((p) => (p ? { ...p, [k]: v } : p));
  }

  async function saveProfile(next?: Profile) {
    const body = next ?? profile;
    if (!body) return;
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
    setMeals((m) => [...m, { ...created, times_per_day: 1, day_types: null, ingredients: [] }]);
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

  async function applyRecalc(next: { id: number; name: string; ingredients: BoundedItem[] }[]) {
    const merged = meals.map((m) => {
      const n = next.find((x) => x.id === m.id);
      return n ? { ...m, ingredients: n.ingredients } : m;
    });
    for (const m of merged) await persist(m);
    setMeals(merged);
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
  const dayLabel = profile.cycling
    ? `${DAY_TYPES.find((d) => d.value === planFor)?.label} day · ${target.kcal.toLocaleString()} kcal`
    : `${target.kcal.toLocaleString()} kcal`;

  return (
    <div className="space-y-3">
      {saved && (
        <div className="num fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm text-[#10160a] shadow-2xl">
          {saved}
        </div>
      )}

      {showRecalc && (
        <RecalculateDialog
          meals={activeMeals.map((m) => ({ id: m.id, name: m.name, ingredients: m.ingredients }))}
          target={target}
          dayLabel={dayLabel}
          defaultMode={profile.calorie_override != null ? "calories_exact" : "balanced"}
          onClose={() => setShowRecalc(false)}
          onApply={applyRecalc}
        />
      )}

      {/* Target vs plan */}
      <section className="card px-5 py-6">
        {profile.cycling && (
          <div className="mb-5">
            <p className="label mb-2">Planning for a</p>
            <Segmented
              size="sm"
              value={planFor}
              onChange={setPlanFor}
              options={DAY_TYPES.map((d) => ({ value: d.value, label: d.label, hint: d.hint }))}
            />
          </div>
        )}

        <div className="flex items-start">
          <div className="mr-auto">
            <p className="label">Daily target</p>
            <p className="num mt-2 text-[3.5rem] sm:text-[4rem]">{target.kcal.toLocaleString()}</p>
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
          {BAR_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-[var(--color-mut)]">
                {MACRO_LABEL[k]}
              </span>
              <Bar value={planTotal[k]} target={target[k]} color={MACRO_COLOR[k]} height={5} />
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--color-mut)]">
                <b className="text-[#f2f4f7]">{Math.round(planTotal[k])}</b> / {Math.round(target[k])}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-[var(--color-mut)]">
          {volumeHeadline(volume)}
        </p>

        <button
          className={`${drift ? "btn btn-accent" : "btn"} mt-5 w-full`}
          onClick={() => setShowRecalc(true)}
          disabled={activeMeals.length === 0}
        >
          Recalculate portions
        </button>
      </section>

      {/* Meals */}
      {meals.map((meal) => {
        const t = totalFor(meal.ingredients);
        const hidden =
          profile.cycling &&
          meal.day_types &&
          meal.day_types.length > 0 &&
          !meal.day_types.includes(planFor);
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

              {profile.cycling && (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[var(--color-mut)]">On</span>
                  {DAY_TYPES.map((d) => {
                    const list = meal.day_types ?? [];
                    const on = list.length === 0 || list.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        className={on ? "btn btn-sm btn-accent" : "btn btn-sm"}
                        onClick={() => {
                          const cur = list.length === 0 ? DAY_TYPES.map((x) => x.value) : list;
                          const next = on
                            ? cur.filter((v) => v !== d.value)
                            : [...cur, d.value];
                          patchMeal(meal.id, {
                            day_types: next.length === 0 || next.length === 4 ? null : next,
                          });
                        }}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </span>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {meal.ingredients.map((it, i) => (
                <IngredientRow
                  key={i}
                  it={it}
                  advanced={advanced}
                  onPatch={(p) => patchItem(meal.id, i, p)}
                  onRemove={() =>
                    patchMeal(meal.id, {
                      ingredients: meal.ingredients.filter((_, j) => j !== i),
                    })
                  }
                />
              ))}
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

      <div className="flex gap-2">
        <button className="btn flex-1" onClick={addMeal}>
          + Add meal
        </button>
        <button className="btn" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Hide limits" : "Show limits"}
        </button>
      </div>

      {/* Training week */}
      <section className="card px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="mr-auto">
            <p className="label">Training week</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
              Give each day its own number. The percentages are balanced across the week, so the
              seven-day average still lands on your goal.
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
            <div className="mt-4 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center">
                  <p className="mb-1 text-[0.65rem] font-semibold text-[var(--color-mut)]">
                    {WEEKDAY_LABEL[d]}
                  </p>
                  <select
                    className="field w-full px-1 py-1.5 text-center text-[0.7rem]"
                    value={profile.week[d]}
                    onChange={(e) =>
                      set("week", { ...profile.week, [d as Weekday]: e.target.value as DayType })
                    }
                  >
                    {DAY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {DAY_TYPES.map((d) => {
                const t = targets(profile, d.value);
                const pct = Math.round((profile.day_adjust[d.value] ?? 0) * 100);
                return (
                  <div key={d.value} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs font-semibold">{d.label}</span>
                    <input
                      type="range"
                      min={-30}
                      max={30}
                      step={1}
                      value={pct}
                      className="flex-1 accent-[var(--color-accent)]"
                      onChange={(e) =>
                        set("day_adjust", {
                          ...profile.day_adjust,
                          [d.value]: Number(e.target.value) / 100,
                        })
                      }
                    />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[var(--color-mut)]">
                      {pct > 0 ? "+" : ""}
                      {pct}%
                    </span>
                    <span className="num w-16 shrink-0 text-right text-sm">
                      {t.kcal.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
              For reference: a 90-minute hard swim at your weight burns roughly{" "}
              <b className="text-[#f2f4f7]">
                {sessionKcal(profile.weight_kg, 90, METS.swim_hard).toLocaleString()} kcal
              </b>
              , an hour in the gym about{" "}
              {sessionKcal(profile.weight_kg, 60, METS.gym).toLocaleString()} kcal.
            </p>
          </>
        )}
      </section>

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
            <Field label="Body fat % — optional, but it makes the BMR figure better">
              <input
                type="number"
                step={0.5}
                className="field w-full"
                placeholder="leave blank to use height and age instead"
                value={profile.body_fat_pct ?? ""}
                onChange={(e) =>
                  set("body_fat_pct", e.target.value ? Number(e.target.value) : null)
                }
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Activity — your baseline, before day-to-day training">
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

          <Field label="Carb floor g/kg — carbs never go below this">
            <Num
              value={profile.carb_floor_per_kg}
              onChange={(v) => set("carb_floor_per_kg", v)}
              step={0.1}
            />
          </Field>

          <Field label="Fibre g per 1000 kcal">
            <Num
              value={profile.fibre_per_1000}
              onChange={(v) => set("fibre_per_1000", v)}
              step={1}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Manual kcal override — your own number, used as the weekly average">
              <input
                type="number"
                className="field w-full"
                value={profile.calorie_override ?? ""}
                placeholder={`${target.base} — calculated`}
                onChange={(e) =>
                  set("calorie_override", e.target.value ? Number(e.target.value) : null)
                }
              />
            </Field>
            {profile.calorie_override != null && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                Using your number. Protein and fat still come from your g/kg settings and carbs take
                the rest, and Recalculate will default to landing this figure exactly.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Stat label="BMR" value={target.bmr} sub={target.method} />
          <Stat label="Maintenance" value={target.maintenance} />
          <Stat
            label={profile.cycling ? "Week average" : "Target"}
            value={target.base}
            accent
          />
        </div>

        <button className="btn btn-accent mt-4 w-full" onClick={() => saveProfile()}>
          Save targets
        </button>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */

function IngredientRow({
  it,
  advanced,
  onPatch,
  onRemove,
}: {
  it: BoundedItem;
  advanced: boolean;
  onPatch: (p: Partial<BoundedItem>) => void;
  onRemove: () => void;
}) {
  const m = itemMacros(it);
  const check = macroConsistency(it);
  const food = profileFor(it.name, it);
  const estimated = (it as any).fibre_estimated as boolean | undefined;

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
            ["fibre_100", "Fib", MACRO_COLOR.fibre],
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
              style={
                key === "fibre_100" && estimated
                  ? { borderStyle: "dashed", color: "var(--color-mut)" }
                  : undefined
              }
              title={
                key === "fibre_100" && estimated
                  ? "Estimated from the type of food — check the packet"
                  : undefined
              }
              value={(it as any)[key] ?? 0}
              onChange={(e) =>
                onPatch({
                  [key]: Number(e.target.value),
                  ...(key === "fibre_100" ? { fibre_estimated: false } : {}),
                } as Partial<BoundedItem>)
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
