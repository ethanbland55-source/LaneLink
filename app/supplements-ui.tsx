"use client";

import { useState } from "react";
import {
  SUPPLEMENT_LIBRARY,
  TIMING_LABEL,
  doseLabel,
  specFor,
  type SuppSpec,
  type SuppTiming,
  type SuppUnit,
  type Supplement,
} from "@/lib/supplements";
import {
  GRADE_BLURB,
  GRADE_COLOUR,
  GRADE_LABEL,
  GRADE_SHORT,
  CITATIONS,
  short,
} from "@/lib/evidence";

import { NumberField } from "./number-field";

const UNITS: SuppUnit[] = ["g", "mg", "mcg", "IU", "capsule", "scoop", "ml"];

/** The evidence badge. The colour is the whole message; the words back it up. */
export function GradeBadge({ spec }: { spec: SuppSpec }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide"
      style={{ color: GRADE_COLOUR[spec.grade], background: "rgba(255,255,255,0.05)" }}
      title={`${GRADE_LABEL[spec.grade]} — ${GRADE_BLURB[spec.grade]}`}
    >
      {GRADE_SHORT[spec.grade]}
    </span>
  );
}

/**
 * What a supplement is for, honestly.
 *
 * The caveat is not small print — for half this list it *is* the finding, and
 * burying it would make the app a shop window. It gets the same weight as the
 * claim.
 */
export function SuppEvidence({ spec }: { spec: SuppSpec }) {
  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs leading-relaxed text-[var(--color-mut)]">{spec.what}</p>
      {spec.swimming && (
        <p className="text-xs leading-relaxed" style={{ color: "var(--color-protein)" }}>
          For a swimmer: {spec.swimming}
        </p>
      )}
      {spec.caveat && (
        <p className="text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
          {spec.caveat}
        </p>
      )}
      <p className="text-[0.68rem] leading-relaxed text-[#5b6270]">
        {spec.refs.map((r) => short(r)).join(" · ")}
      </p>
    </div>
  );
}

/** The full reference list, for when you want to go and read the thing. */
export function References({ keys }: { keys: string[] }) {
  const seen = [...new Set(keys)].map((k) => CITATIONS[k]).filter(Boolean);
  if (!seen.length) return null;
  return (
    <ul className="mt-2 space-y-2">
      {seen.map((c) => (
        <li key={c.key} className="text-[0.7rem] leading-relaxed text-[#5b6270]">
          <span className="text-[var(--color-mut)]">
            {c.authors} ({c.year}).
          </span>{" "}
          {c.title}. <i>{c.source}</i>.
        </li>
      ))}
    </ul>
  );
}

/**
 * Pick something off the shelf, or describe your own.
 *
 * The library is first because most of what people take is on it, and picking
 * from it carries the dose, the timing and the evidence across rather than
 * asking you to remember any of them.
 */
export function AddSupplement({
  onAdd,
  existing,
}: {
  onAdd: (s: Partial<Supplement>) => void;
  existing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SuppSpec | null>(null);
  const taken = new Set(existing.map((n) => n.toLowerCase()));

  if (!open) {
    return (
      <button className="btn btn-sm mt-3" onClick={() => setOpen(true)}>
        Add a supplement
      </button>
    );
  }

  return (
    <div className="sunk mt-3 px-4 py-3.5">
      <div className="flex items-center">
        <p className="label mr-auto">Add a supplement</p>
        <button className="btn btn-sm btn-quiet" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUPPLEMENT_LIBRARY.map((s) => {
          const had = taken.has(s.name.toLowerCase());
          return (
            <button
              key={s.name}
              disabled={had}
              onMouseEnter={() => setPreview(s)}
              onFocus={() => setPreview(s)}
              onClick={() => setPreview(preview?.name === s.name ? null : s)}
              className={preview?.name === s.name ? "btn btn-sm btn-accent" : "btn btn-sm"}
              title={had ? "Already on your list" : GRADE_BLURB[s.grade]}
            >
              {s.name}
            </button>
          );
        })}
      </div>

      {preview && (
        <div className="mt-3 border-t border-[#1c1f25] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-semibold">{preview.name}</p>
            <GradeBadge spec={preview} />
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-mut)]">
            {doseLabel(preview)} · {TIMING_LABEL[preview.timing]}
            {preview.kcal > 0 && ` · ${preview.kcal} kcal, ${preview.protein} g protein`}
          </p>
          <SuppEvidence spec={preview} />
          <button
            className="btn btn-sm btn-accent mt-3"
            onClick={() => {
              onAdd({
                name: preview.name,
                dose: preview.dose,
                unit: preview.unit,
                timing: preview.timing,
                kcal: preview.kcal,
                protein: preview.protein,
                carbs: preview.carbs,
                fat: preview.fat,
              });
              setPreview(null);
              setOpen(false);
            }}
          >
            Add {preview.name.toLowerCase()}
          </button>
        </div>
      )}

      <button
        className="btn btn-sm btn-quiet mt-3"
        onClick={() => {
          onAdd({ name: "Supplement", dose: 1, unit: "capsule", timing: "anytime" });
          setOpen(false);
        }}
      >
        Something else
      </button>
    </div>
  );
}

/** One supplement, editable. */
export function SupplementRow({
  s,
  meals,
  dayTypes,
  onPatch,
  onSave,
  onDelete,
}: {
  s: Supplement;
  meals: { id: number; name: string }[];
  dayTypes: { id: number; name: string }[];
  onPatch: (p: Partial<Supplement>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const spec = specFor(s.name);
  const [open, setOpen] = useState(false);

  return (
    <div className="sunk px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field-bare min-w-0 flex-1 basis-24 rounded-md border px-1.5 py-1 text-sm font-semibold"
          value={s.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
        {spec && <GradeBadge spec={spec} />}
        <button className="btn btn-sm btn-quiet" onClick={() => setOpen(!open)}>
          {open ? "Done" : "Edit"}
        </button>
      </div>

      <p className="mt-1.5 text-xs text-[var(--color-mut)]">
        {doseLabel(s)} · {TIMING_LABEL[s.timing]}
        {s.times_per_day > 1 && ` · ${s.times_per_day}× a day`}
        {s.meal_id != null && ` · with ${meals.find((m) => m.id === s.meal_id)?.name ?? "a meal"}`}
        {s.kcal > 0 && ` · ${s.kcal} kcal`}
      </p>

      {open && (
        <div className="mt-3 space-y-3 border-t border-[#1c1f25] pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[0.68rem] text-[var(--color-mut)]">Dose</span>
              <NumberField
                className="w-20 py-1 text-right text-xs"
                value={s.dose}
                onCommit={(v) => v != null && onPatch({ dose: v })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.68rem] text-[var(--color-mut)]">Unit</span>
              <select
                className="field w-24 py-1 text-xs"
                value={s.unit}
                onChange={(e) => onPatch({ unit: e.target.value as SuppUnit })}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.68rem] text-[var(--color-mut)]">When</span>
              <select
                className="field w-36 py-1 text-xs"
                value={s.timing}
                onChange={(e) => onPatch({ timing: e.target.value as SuppTiming })}
              >
                {(Object.keys(TIMING_LABEL) as SuppTiming[]).map((t) => (
                  <option key={t} value={t}>
                    {TIMING_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[0.68rem] text-[var(--color-mut)]">A day</span>
              <NumberField
                min={1}
                className="w-16 py-1 text-right text-xs"
                value={s.times_per_day}
                onCommit={(v) => onPatch({ times_per_day: v ?? 1 })}
              />
            </label>
          </div>

          {/* Macros. Almost always zero, which is why they're tucked in here. */}
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                ["kcal", "kcal"],
                ["protein", "P"],
                ["carbs", "C"],
                ["fat", "F"],
              ] as const
            ).map(([k, tag]) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[0.68rem] text-[var(--color-mut)]">
                  {tag} per dose
                </span>
                <NumberField
                  className="w-[4.2rem] py-1 text-right text-xs"
                  value={(s as any)[k]}
                  onCommit={(v) => onPatch({ [k]: v ?? 0 } as Partial<Supplement>)}
                />
              </label>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-[0.68rem] text-[var(--color-mut)]">
              Taken with a meal
            </span>
            <select
              className="field w-full py-1 text-xs"
              value={s.meal_id ?? 0}
              onChange={(e) => onPatch({ meal_id: Number(e.target.value) || null })}
            >
              <option value={0}>On its own</option>
              {meals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          {dayTypes.length > 1 && (
            <div>
              <span className="mb-1.5 block text-[0.68rem] text-[var(--color-mut)]">On</span>
              <div className="flex flex-wrap gap-1.5">
                {dayTypes.map((d) => {
                  const list = s.day_type_ids ?? [];
                  const on = list.length === 0 || list.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      className={on ? "btn btn-sm btn-accent" : "btn btn-sm"}
                      onClick={() => {
                        const all = dayTypes.map((x) => x.id);
                        const cur = list.length === 0 ? all : list;
                        const next = on ? cur.filter((v) => v !== d.id) : [...cur, d.id];
                        onPatch({
                          day_type_ids:
                            next.length === 0 || next.length === all.length ? null : next,
                        });
                      }}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {spec && <SuppEvidence spec={spec} />}

          <div className="flex gap-2">
            <button className="btn btn-sm btn-accent" onClick={onSave}>
              Save
            </button>
            <button className="btn btn-sm btn-quiet" onClick={onDelete}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
