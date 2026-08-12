"use client";

import { useMemo, useState } from "react";
import { MACRO_COLOR, MACRO_LABEL, type MacroKey } from "./macro-ui";
import { boundsFor, optimisePortions, type BoundedItem } from "@/lib/optimise";
import type { Macros } from "@/lib/nutrition";

type Meal = { id: number; name: string; ingredients: BoundedItem[] };

const KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

/**
 * Preview-and-apply for the portion optimiser. Nothing is written until
 * "Apply" — widen a limit or lock an ingredient and the fit updates live.
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
  const [draft, setDraft] = useState<Meal[]>(() => structuredClone(meals));
  const [saving, setSaving] = useState(false);

  // The fit is a whole-day fit, so flatten every ingredient across every meal.
  const flat = useMemo(
    () => draft.flatMap((m) => m.ingredients.map((it, i) => ({ mealId: m.id, index: i, it }))),
    [draft]
  );

  const result = useMemo(() => optimisePortions(flat.map((f) => f.it), target), [flat, target]);

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

  // A portion limit only matters if it actually held a macro off target.
  const missed = KEYS.filter(
    (k) => Math.abs(result.after[k] - target[k]) > Math.max(2, target[k] * 0.02)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="card flex max-h-[92vh] w-full max-w-2xl flex-col rounded-b-none sm:rounded-b-[1.25rem]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <h2 className="mr-auto text-lg font-bold tracking-tight">Rebalance portions</h2>
          <button className="btn btn-sm btn-quiet px-2.5" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Result */}
        <div className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-4">
          {KEYS.map((k) => {
            const after = result.after[k];
            const t = target[k];
            const hit = Math.abs(after - t) <= Math.max(2, t * 0.02);
            return (
              <div key={k} className="sunk px-3 py-3">
                <p className="label">{MACRO_LABEL[k]}</p>
                <p className="num mt-1.5 text-2xl" style={{ color: MACRO_COLOR[k] }}>
                  {Math.round(after)}
                </p>
                <p className="mt-1 text-xs tabular-nums text-[var(--color-mut)]">
                  was {Math.round(result.before[k])}
                  {!hit && (
                    <span style={{ color: "var(--color-carbs)" }}>
                      {" · "}
                      {after > t ? "+" : ""}
                      {Math.round(after - t)}
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        {result.constrained && missed.length > 0 && (
          <p className="mx-5 mt-3 rounded-xl bg-[#2a2416] px-3.5 py-2.5 text-xs text-[#ffd08a]">
            Limits reached — {missed.map((k) => MACRO_LABEL[k].toLowerCase()).join(", ")} can't
            close without an unrealistic portion.
          </p>
        )}

        {/* Rows */}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-5">
          {draft.map((meal) => {
            const rows = flat.map((f, gi) => ({ ...f, gi })).filter((f) => f.mealId === meal.id);
            if (!rows.length) return null;
            return (
              <div key={meal.id} className="mb-5 last:mb-0">
                <p className="label mb-2">{meal.name}</p>
                <div className="space-y-1.5">
                  {rows.map(({ it, index, gi }) => {
                    const from = Number(it.grams);
                    const to = result.grams[gi];
                    const delta = to - from;
                    const b = boundsFor(it);
                    return (
                      <div key={index} className="sunk flex flex-wrap items-center gap-2 px-3 py-2">
                        <button
                          title={it.locked ? "Locked" : "Lock this portion"}
                          onClick={() => patch(meal.id, index, { locked: !it.locked })}
                          className="shrink-0 rounded-lg p-1 transition hover:bg-white/5"
                          style={{ color: it.locked ? "var(--color-accent)" : "#454b57" }}
                        >
                          <LockIcon open={!it.locked} />
                        </button>

                        {/* Basis keeps the name legible — on a phone the numbers
                            wrap to their own line instead of truncating it. */}
                        <span
                          className="min-w-0 flex-1 basis-[8rem] truncate text-sm font-medium"
                          style={it.locked ? { color: "var(--color-mut)" } : undefined}
                        >
                          {it.name}
                        </span>

                        <span className="num ml-auto text-sm text-[#545b68]">{from}</span>
                        <span className="text-[#454b57]">→</span>
                        <span
                          className="num w-14 text-right text-sm"
                          style={{
                            color:
                              Math.abs(delta) < 0.5
                                ? "var(--color-mut)"
                                : delta > 0
                                  ? "var(--color-accent)"
                                  : "var(--color-fat)",
                          }}
                        >
                          {Math.round(to)}g
                        </span>

                        <span className="flex shrink-0 items-center gap-1">
                          <input
                            type="number"
                            title="Smallest portion you'd accept"
                            className="field w-[3.9rem] px-1.5 py-1 text-right text-xs"
                            value={it.min_grams ?? b.min}
                            disabled={it.locked}
                            onChange={(e) =>
                              patch(meal.id, index, { min_grams: Number(e.target.value) })
                            }
                          />
                          <span className="text-xs text-[#454b57]">–</span>
                          <input
                            type="number"
                            title="Largest portion you'd accept"
                            className="field w-[3.9rem] px-1.5 py-1 text-right text-xs"
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
        <div className="flex gap-2 px-5 pb-5 pt-4">
          <button className="btn flex-1" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent flex-1" disabled={saving} onClick={apply}>
            {saving ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Padlock — the shackle lifts and shifts right when the portion is unlocked. */
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
