"use client";

import type { Macros } from "@/lib/nutrition";

const COLORS = {
  kcal: "var(--color-accent)",
  protein: "var(--color-protein)",
  carbs: "var(--color-carbs)",
  fat: "var(--color-fat)",
} as const;

export type MacroKey = keyof typeof COLORS;

const UNIT: Record<MacroKey, string> = { kcal: "kcal", protein: "g", carbs: "g", fat: "g" };
const LABEL: Record<MacroKey, string> = {
  kcal: "Calories",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
};

/** A single macro dial: big number, remaining, and a fill bar. */
export function MacroDial({
  k,
  eaten,
  target,
}: {
  k: MacroKey;
  eaten: number;
  target: number;
}) {
  const pct = target > 0 ? Math.min(100, (eaten / target) * 100) : 0;
  const over = target > 0 && eaten > target;
  const left = Math.round(target - eaten);

  return (
    <div className="panel px-3.5 py-3">
      <p className="label">{LABEL[k]}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="text-[1.75rem] font-black leading-none tabular-nums tracking-tight"
          style={{ color: over ? "var(--color-fat)" : COLORS[k] }}
        >
          {Math.round(eaten)}
        </span>
        <span className="text-sm text-[#8a97ae]">
          / {Math.round(target)}
          {UNIT[k]}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#161d2c]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: over ? "var(--color-fat)" : COLORS[k],
            boxShadow: `0 0 10px ${over ? "var(--color-fat)" : COLORS[k]}`,
          }}
        />
      </div>
      <p className="mt-1.5 text-[0.7rem] text-[#8a97ae]">
        {over ? (
          <span className="text-[#ff6f91]">
            {Math.abs(left)}
            {UNIT[k]} over
          </span>
        ) : (
          <>
            {left}
            {UNIT[k]} left
          </>
        )}
      </p>
    </div>
  );
}

export function MacroRow({ eaten, target }: { eaten: Macros; target: Macros }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(["kcal", "protein", "carbs", "fat"] as MacroKey[]).map((k) => (
        <MacroDial key={k} k={k} eaten={eaten[k]} target={target[k]} />
      ))}
    </div>
  );
}

/** Compact inline macro summary, e.g. under a meal card. */
export function MacroChips({ m }: { m: Macros }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[0.72rem] font-semibold">
      <Chip v={`${Math.round(m.kcal)} kcal`} c={COLORS.kcal} />
      <Chip v={`P ${m.protein.toFixed(1)}g`} c={COLORS.protein} />
      <Chip v={`C ${m.carbs.toFixed(1)}g`} c={COLORS.carbs} />
      <Chip v={`F ${m.fat.toFixed(1)}g`} c={COLORS.fat} />
    </div>
  );
}

function Chip({ v, c }: { v: string; c: string }) {
  return (
    <span
      className="rounded-md px-1.5 py-0.5"
      style={{ color: c, background: "rgba(255,255,255,0.04)" }}
    >
      {v}
    </span>
  );
}
