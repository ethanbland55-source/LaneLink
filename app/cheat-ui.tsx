"use client";

import { useMemo, useState } from "react";
import { Sheet } from "./sheet";
import { NumberField } from "./number-field";
import { Note } from "./explain";
import { MACRO_COLOR } from "./macro-ui";
import { completeCheat, type CheatMeal } from "@/lib/cheat";
import type { PlanMeal } from "@/lib/batch";

/* ------------------------------------------------------------------ */
/* The card on Today                                                   */
/* ------------------------------------------------------------------ */

/**
 * One meal out a week, logged as what it was.
 *
 * Deliberately not a warning, and no longer a rescue either. It used to shrink
 * the rest of the day and spread what was left over the days after, which made
 * a meal out look free and made it impossible to see whether it had cost
 * anything. Now it is recorded against the day, in place of the meal it
 * replaced, and nothing else moves — the trend on the Progress page is what
 * says whether it made a difference.
 */
export function CheatCard({
  cheat,
  replaced,
  used,
  onOpen,
  onClear,
}: {
  cheat: CheatMeal | null;
  /** The planned meal it took the place of, by name. */
  replaced: string | null;
  /** Whether this plan week already has one. */
  used: boolean;
  onOpen: () => void;
  onClear: () => void;
}) {
  if (!cheat) {
    return (
      <section className="card flex items-center gap-3 px-5 py-4">
        <div className="mr-auto min-w-0">
          <p className="text-sm font-bold">
            {used ? "This week's cheat meal is used" : "Cheat meal"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-mut)]">
            {used
              ? "One a week. It's on another day this week — nothing to do here."
              : "Log a meal out in place of one of yours. Nothing else changes."}
          </p>
        </div>
        {!used && (
          <button className="btn btn-sm shrink-0" onClick={onOpen}>
            Add
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="card px-5 py-4">
      <div className="flex items-baseline gap-3">
        <p className="mr-auto min-w-0 truncate text-sm font-bold">{cheat.name}</p>
        <button className="btn btn-sm shrink-0" onClick={onOpen}>
          Edit
        </button>
        <button className="btn btn-sm shrink-0" onClick={onClear}>
          Remove
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
        <span className="font-semibold">{Math.round(cheat.kcal)} kcal</span>
        {(["protein", "carbs", "fat"] as const).map((k) => (
          <span key={k} style={{ color: MACRO_COLOR[k] }}>
            {Math.round(cheat[k])} g {k}
          </span>
        ))}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
        {replaced ? `Logged instead of ${replaced}.` : "Logged on top of the day."} The rest of
        the day and the week stay as planned — your weigh-ins and scans will show whether it made a
        difference.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Entering one                                                        */
/* ------------------------------------------------------------------ */

/**
 * Macros, not grams.
 *
 * You are typing this at a table with a menu in front of you. There is no
 * scale, there is no ingredient list, and asking for 180 g of anything would
 * mean the meal never gets entered. Calories alone is a perfectly good answer
 * and the split gets estimated; if the place publishes the full breakdown, so
 * much the better.
 */
export function CheatSheet({
  day,
  meals,
  existing,
  onClose,
  onSave,
}: {
  day: string;
  meals: PlanMeal[];
  existing: CheatMeal | null;
  onClose: () => void;
  onSave: (c: Omit<CheatMeal, "id">) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [mealId, setMealId] = useState<number | null>(existing?.meal_id ?? meals.at(-1)?.id ?? null);
  const [kcal, setKcal] = useState<number | null>(existing?.kcal || null);
  const [protein, setProtein] = useState<number | null>(existing?.protein || null);
  const [carbs, setCarbs] = useState<number | null>(existing?.carbs || null);
  const [fat, setFat] = useState<number | null>(existing?.fat || null);
  const [saving, setSaving] = useState(false);

  const preview = useMemo(
    () => completeCheat({ kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }),
    [kcal, protein, carbs, fat]
  );
  const estimated = (protein ?? 0) + (carbs ?? 0) + (fat ?? 0) === 0 && (kcal ?? 0) > 0;
  const swapped = meals.find((m) => m.id === mealId) ?? null;

  async function save() {
    setSaving(true);
    await onSave({
      day,
      meal_id: mealId,
      name: name.trim() || "Cheat meal",
      kcal: preview.kcal,
      protein: preview.protein,
      carbs: preview.carbs,
      fat: preview.fat,
    });
    setSaving(false);
  }

  return (
    <Sheet onClose={onClose} label="Cheat meal">
      <div className="shrink-0 px-5 pb-3 pt-2 sm:pt-5">
        <h2 className="text-lg font-bold tracking-tight">Cheat meal</h2>
        <p className="mt-0.5 text-xs text-[var(--color-mut)]">
          One a week. Logged as it was — nothing else in the plan moves to make room.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
        <div>
          <p className="label mb-1.5">What is it</p>
          <input
            className="input w-full"
            value={name}
            placeholder="Curry with the lads"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <p className="label mb-1.5">Instead of</p>
          <div className="space-y-1">
            {meals.map((m) => (
              <button
                key={m.id}
                onClick={() => setMealId(m.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition"
                style={{
                  background: mealId === m.id ? "var(--color-accent)" : "var(--color-surface)",
                  color: mealId === m.id ? "#10160a" : "var(--color-fg)",
                }}
              >
                <span className="truncate font-semibold">{m.name}</span>
              </button>
            ))}
            <button
              onClick={() => setMealId(null)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition"
              style={{
                background: mealId === null ? "var(--color-accent)" : "var(--color-surface)",
                color: mealId === null ? "#10160a" : "var(--color-fg)",
              }}
            >
              <span className="truncate font-semibold">Nothing — it&rsquo;s on top</span>
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
            {swapped
              ? `${swapped.name} comes off today's list and this goes in its place. The rest of the day stays as planned.`
              : "Nothing comes off — it's logged on top of the day, and the rest stays as planned."}
          </p>
        </div>

        <div>
          <p className="label mb-1.5">Calories</p>
          <NumberField
            value={kcal}
            allowEmpty
            onCommit={setKcal}
            inputMode="numeric"
            placeholder="1200"
            className="input w-full"
          />
        </div>

        <div>
          <p className="label mb-1.5">Macros, if you have them</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["protein", protein, setProtein],
                ["carbs", carbs, setCarbs],
                ["fat", fat, setFat],
              ] as const
            ).map(([k, v, set]) => (
              <div key={k}>
                <p
                  className="mb-1 text-[0.7rem] font-semibold capitalize"
                  style={{ color: MACRO_COLOR[k] }}
                >
                  {k} g
                </p>
                <NumberField
                  value={v}
                  allowEmpty
                  onCommit={set as (n: number | null) => void}
                  inputMode="numeric"
                  className="input w-full"
                />
              </div>
            ))}
          </div>
          {estimated && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
              Left blank, so they&rsquo;re estimated at roughly a fifth protein and a third fat —
              what a meal out usually is. Fill them in if the place publishes them and the day
              is logged properly rather than approximately.
            </p>
          )}
          {!estimated && (kcal ?? 0) > 0 && Math.abs(preview.kcal - (kcal ?? 0)) > 60 && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-carbs)]">
              Those macros come to {Math.round(preview.protein * 4 + preview.carbs * 4 + preview.fat * 9)}{" "}
              kcal, not {Math.round(kcal ?? 0)}. Not necessarily wrong — labels round — but worth a
              second look.
            </p>
          )}
        </div>
      </div>

      <div className="safe-b flex shrink-0 gap-2 border-t border-[#1c1f25] px-5 pt-4">
        <button className="btn flex-1" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-accent flex-1"
          disabled={saving || preview.kcal <= 0}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
