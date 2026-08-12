"use client";

import type { Macros } from "@/lib/nutrition";

export const MACRO_COLOR = {
  kcal: "var(--color-accent)",
  protein: "var(--color-protein)",
  carbs: "var(--color-carbs)",
  fat: "var(--color-fat)",
} as const;

export type MacroKey = keyof typeof MACRO_COLOR;

export const MACRO_LABEL: Record<MacroKey, string> = {
  kcal: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
};

/** A flat progress track. No glow, no gradient — just the fill. */
export function Bar({
  value,
  target,
  color,
  height = 6,
}: {
  value: number;
  target: number;
  color: string;
  height?: number;
}) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target * 1.02;
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-[#23262c]"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%`, background: over ? "var(--color-fat)" : color }}
      />
    </div>
  );
}

/**
 * One macro, one big number. The gram figure leads; the target is a quiet
 * denominator underneath rather than competing for attention.
 */
export function MacroTile({ k, eaten, target }: { k: MacroKey; eaten: number; target: number }) {
  const over = eaten > target * 1.02;
  return (
    <div className="card px-4 py-3.5">
      <p className="label">{MACRO_LABEL[k]}</p>
      <p className="num mt-2 text-[1.9rem]" style={{ color: over ? "var(--color-fat)" : MACRO_COLOR[k] }}>
        {Math.round(eaten)}
        <span className="ml-0.5 text-sm font-semibold text-[var(--color-mut)]">g</span>
      </p>
      <div className="mt-2.5">
        <Bar value={eaten} target={target} color={MACRO_COLOR[k]} height={5} />
      </div>
      <p className="mt-2 text-xs text-[var(--color-mut)]">of {Math.round(target)}g</p>
    </div>
  );
}

/** Compact macro summary for a meal row. */
export function MacroChips({ m }: { m: Macros }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold tabular-nums">
      <span style={{ color: MACRO_COLOR.kcal }}>{Math.round(m.kcal)} kcal</span>
      <span style={{ color: MACRO_COLOR.protein }}>{m.protein.toFixed(0)}P</span>
      <span style={{ color: MACRO_COLOR.carbs }}>{m.carbs.toFixed(0)}C</span>
      <span style={{ color: MACRO_COLOR.fat }}>{m.fat.toFixed(0)}F</span>
    </div>
  );
}
