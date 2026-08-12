"use client";

import { useMemo, useState } from "react";
import { boundsFor, optimisePortions, type BoundedItem } from "@/lib/optimise";
import type { Macros } from "@/lib/nutrition";

type Meal = { id: number; name: string; ingredients: BoundedItem[] };

const KEYS = ["kcal", "protein", "carbs", "fat"] as const;
const LABEL = { kcal: "Calories", protein: "Protein", carbs: "Carbs", fat: "Fat" };
const UNIT = { kcal: "", protein: "g", carbs: "g", fat: "g" };
const COLOR = {
  kcal: "var(--color-accent)",
  protein: "var(--color-protein)",
  carbs: "var(--color-carbs)",
  fat: "var(--color-fat)",
};

/**
 * Preview-and-apply dialog for the portion optimiser. Nothing is written until
 * "Apply" — you can widen a limit or lock an ingredient and watch the fit
 * change first.
 */
export function RecalculateDialog({
  meals,
  target,
  onClose,
  onApply,
}: {
  meals: Meal[];
  target: Macros;
  onClose: () => void;
  onApply: (meals: Meal[]) => Promise<void>;
}) {
  // Flatten every ingredient across every meal — the fit is a whole-day fit.
  const [draft, setDraft] = useState<Meal[]>(() => structuredClone(meals));
  const [saving, setSaving] = useState(false);

  const flat = useMemo(
    () => draft.flatMap((m) => m.ingredients.map((it, i) => ({ mealId: m.id, index: i, it }))),
    [draft]
  );

  const result = useMemo(
    () => optimisePortions(flat.map((f) => f.it), target),
    [flat, target]
  );

  function patch(mealId: number, index: number, p: Partial<BoundedItem>) {
    setDraft((ms) =>
      ms.map((m) =>
        m.id !== mealId
          ? m
          : { ...m, ingredients: m.ingredients.map((it, i) => (i === index ? { ...it, ...p } : it)) }
      )
    );
  }

  async function apply() {
    setSaving(true);
    let n = 0;
    const next = draft.map((m) => ({
      ...m,
      ingredients: m.ingredients.map((it) => ({ ...it, grams: result.grams[n++] })),
    }));
    await onApply(next);
    setSaving(false);
  }

  const changed = flat.filter((f, i) => Math.abs(result.grams[i] - Number(f.it.grams)) > 0.5).length;

  // Hitting a portion limit only matters if it actually stopped us reaching
  // the target — otherwise the fit is fine and the warning is just noise.
  const missed = KEYS.filter(
    (k) => Math.abs(result.after[k] - target[k]) > Math.max(2, target[k] * 0.02)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6">
      <div className="panel my-auto w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-[#1e2637] px-5 py-4">
          <div className="mr-auto">
            <h2 className="text-lg font-bold tracking-tight">Rebalance portions</h2>
            <p className="mt-0.5 text-xs text-[#8a97ae]">
              Adjusts every gram amount to hit your targets, staying inside realistic limits.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Before / after per macro */}
        <div className="grid grid-cols-2 gap-2 px-5 py-4 sm:grid-cols-4">
          {KEYS.map((k) => {
            const before = result.before[k];
            const after = result.after[k];
            const t = target[k];
            const hit = Math.abs(after - t) <= Math.max(2, t * 0.02);
            return (
              <div key={k} className="rounded-xl border border-[#1e2637] bg-[#070b14] px-3 py-2.5">
                <p className="label">{LABEL[k]}</p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-sm text-[#5d6a80] line-through">{Math.round(before)}</span>
                  <span className="text-xl font-black tabular-nums" style={{ color: COLOR[k] }}>
                    {Math.round(after)}
                  </span>
                </div>
                <p className="mt-0.5 text-[0.68rem] text-[#8a97ae]">
                  target {Math.round(t)}
                  {UNIT[k]}{" "}
                  <span style={{ color: hit ? "var(--color-accent)" : "var(--color-carbs)" }}>
                    {hit ? "✓" : `${after > t ? "+" : ""}${Math.round(after - t)}`}
                  </span>
                </p>
              </div>
            );
          })}
        </div>

        {result.constrained && missed.length > 0 && (
          <p className="mx-5 mb-3 rounded-lg border border-[#ffb547]/30 bg-[#ffb547]/10 px-3 py-2 text-xs leading-relaxed text-[#ffd08a]">
            Still off on <b>{missed.map((k) => LABEL[k].toLowerCase()).join(", ")}</b> — ingredients
            hit their portion limits first. That's the optimiser refusing to put an unrealistic
            amount on your plate. Widen a limit below, or add an ingredient, to close the gap.
          </p>
        )}

        {/* Per-ingredient changes */}
        <div className="flex items-center gap-2 border-t border-[#1e2637] px-5 pt-3 text-[0.66rem] uppercase tracking-wider text-[#5d6a80]">
          <span className="mr-auto">Lock · ingredient</span>
          <span>now → new</span>
          <span className="w-[6.6rem] text-center">limits (g)</span>
        </div>

        <div className="max-h-[45vh] overflow-y-auto px-5 py-2">
          {draft.map((meal) => {
            const rows = flat
              .map((f, gi) => ({ ...f, gi }))
              .filter((f) => f.mealId === meal.id);
            if (!rows.length) return null;
            return (
              <div key={meal.id} className="mb-4 last:mb-0">
                <p className="label mb-1.5">{meal.name}</p>
                <div className="space-y-1">
                  {rows.map(({ it, index, gi }) => {
                    const from = Number(it.grams);
                    const to = result.grams[gi];
                    const delta = to - from;
                    const b = boundsFor(it);
                    return (
                      <div
                        key={index}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]"
                      >
                        <button
                          title={it.locked ? "Locked — click to allow changes" : "Lock this portion"}
                          onClick={() => patch(meal.id, index, { locked: !it.locked })}
                          className="shrink-0 rounded-md p-1 hover:bg-white/5"
                          style={{ color: it.locked ? "var(--color-accent)" : "#3d4759" }}
                        >
                          <LockIcon open={!it.locked} />
                        </button>

                        <span
                          className="mr-auto min-w-0 flex-1 truncate text-sm"
                          style={it.locked ? { color: "#8a97ae" } : undefined}
                        >
                          {it.name}
                        </span>

                        <span className="tabular-nums text-sm text-[#5d6a80]">{from}g</span>
                        <span className="text-[#3d4759]">→</span>
                        <span
                          className="w-12 text-right text-sm font-bold tabular-nums"
                          style={{
                            color:
                              Math.abs(delta) < 0.5
                                ? "#8a97ae"
                                : delta > 0
                                  ? "var(--color-accent)"
                                  : "var(--color-fat)",
                          }}
                        >
                          {Math.round(to)}g
                        </span>

                        <span className="flex shrink-0 items-center gap-1 text-[0.7rem] text-[#5d6a80]">
                          <input
                            type="number"
                            title="Smallest portion you'd accept"
                            className="field w-12 px-1 py-0.5 text-right text-[0.7rem] disabled:opacity-40"
                            value={it.min_grams ?? b.min}
                            disabled={it.locked}
                            onChange={(e) =>
                              patch(meal.id, index, { min_grams: Number(e.target.value) })
                            }
                          />
                          <span>–</span>
                          <input
                            type="number"
                            title="Largest portion you'd accept"
                            className="field w-12 px-1 py-0.5 text-right text-[0.7rem] disabled:opacity-40"
                            value={it.max_grams ?? b.max}
                            disabled={it.locked}
                            onChange={(e) =>
                              patch(meal.id, index, { max_grams: Number(e.target.value) })
                            }
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[#1e2637] px-5 py-3">
          <p className="mr-auto text-xs text-[#8a97ae]">
            {changed} of {flat.length} portions change · limits are saved with your plan
          </p>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" disabled={saving} onClick={apply}>
            {saving ? "Applying…" : "Apply to plan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Padlock — shackle lifts and shifts right when the portion is unlocked. */
function LockIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" fill="currentColor" />
      <path
        d={open ? "M9 11V7a4 4 0 0 1 7-2.6" : "M8 11V7a4 4 0 0 1 8 0v4"}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
