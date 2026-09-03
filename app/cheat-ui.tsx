"use client";

import { useMemo, useState } from "react";
import { Sheet } from "./sheet";
import { NumberField } from "./number-field";
import { MACRO_COLOR } from "./macro-ui";
import { completeCheat, type Absorption, type CheatMeal } from "@/lib/cheat";
import type { PlanMeal } from "@/lib/batch";

/* ------------------------------------------------------------------ */
/* The card on Today                                                   */
/* ------------------------------------------------------------------ */

/**
 * One meal out a week, and what the week does about it.
 *
 * Deliberately not a warning. A cheat meal that comes with a telling-off is a
 * cheat meal you stop logging, and an unlogged one is the only kind that
 * actually costs you anything — the whole mechanism here depends on the app
 * knowing it happened. So the card states the arithmetic and gets out of the
 * way.
 */
export function CheatCard({
  cheat,
  absorption,
  used,
  onOpen,
  onClear,
}: {
  cheat: CheatMeal | null;
  absorption: Absorption | null;
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
              : "Swap any meal for whatever you're actually eating. The rest of the day makes room."}
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

      {absorption && <AbsorptionReport a={absorption} />}
    </section>
  );
}

/**
 * What the day and the week do to make room.
 *
 * The order on screen matches the order the logic tries things in, because
 * that order *is* the explanation: the swap costs nothing, shrinking costs
 * little, dropping a meal costs something, and what's left over is the only
 * part that is actually a cost. Reading it top to bottom tells you how
 * expensive this particular meal was.
 */
function AbsorptionReport({ a }: { a: Absorption }) {
  const moved = a.meals.filter((m) => m.action !== "kept");

  return (
    <div className="mt-3 space-y-2.5 border-t border-[#1c1f25] pt-3">
      {moved.length > 0 && (
        <ul className="space-y-1">
          {moved.map((m) => (
            <li key={m.mealId} className="text-xs">
              <span className="flex items-baseline gap-2">
                <span
                  className="truncate font-semibold"
                  style={{
                    color:
                      m.action === "resized" ? "var(--color-fg)" : "var(--color-mut)",
                    textDecoration:
                      m.action === "dropped" || m.action === "replaced"
                        ? "line-through"
                        : undefined,
                  }}
                >
                  {m.name}
                </span>
                <span className="ml-auto shrink-0 text-[var(--color-mut)]">
                  {m.action === "replaced"
                    ? "swapped out"
                    : m.action === "dropped"
                      ? "off today"
                      : `${Math.round(m.after.kcal)} kcal`}
                </span>
              </span>
              {m.action === "resized" && m.portions.length > 0 && (
                <span className="mt-0.5 block text-[0.7rem] text-[var(--color-mut)]">
                  {m.portions
                    .slice(0, 3)
                    .map((p) => `${p.name} ${Math.round(p.from)}→${Math.round(p.to)} g`)
                    .join(", ")}
                </span>
              )}
              {m.why && m.action !== "resized" && (
                <span className="mt-0.5 block text-[0.7rem] text-[var(--color-mut)]">{m.why}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
        <span className="text-[var(--color-mut)]">
          Day lands <b className="text-[var(--color-fg)]">{Math.round(a.after.kcal)}</b> against{" "}
          {Math.round(a.target.kcal)}
        </span>
        <span className="text-[var(--color-mut)]">
          protein <b className="text-[var(--color-fg)]">{Math.round(a.after.protein)}</b> /{" "}
          {Math.round(a.target.protein)} g
        </span>
      </div>

      {a.spread.length > 0 && (
        <div>
          <p className="text-xs font-semibold">Spread over the rest of the week</p>
          <ul className="mt-1 space-y-0.5">
            {a.spread.map((s) => (
              <li
                key={s.day}
                className="flex items-baseline gap-2 text-xs text-[var(--color-mut)]"
              >
                <span className="capitalize">{s.weekday}</span>
                <span className="ml-auto tabular-nums">&minus;{s.kcal} kcal</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.notes.map((n, i) => (
        <p key={i} className="text-xs leading-relaxed text-[var(--color-mut)]">
          {n}
        </p>
      ))}
    </div>
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
          One a week, on top of nothing. What it costs gets worked out, not waved through.
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
              ? `${swapped.name} comes off the day. That's usually most of the room right there.`
              : "Nothing comes off, so the whole day and the days after it have to find the room. Doable, just dearer."}
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
              will be worked out properly rather than approximately.
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
