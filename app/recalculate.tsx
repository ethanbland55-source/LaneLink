"use client";

import { useMemo, useState } from "react";
import { MACRO_COLOR, MACRO_LABEL, Segmented } from "./macro-ui";
import {
  boundsFor,
  optimisePortions,
  unitOf,
  MODES,
  type BoundedItem,
  type MacroKey,
  type Mode,
  type Suggestion,
} from "@/lib/optimise";
import { smartBounds, VOLUME_FOODS } from "@/lib/foods";
import { dayVolume, fillerSuggestions, volumeHeadline } from "@/lib/prep";
import { collapse, expand, servingGrams } from "@/lib/batch";
import type { Macros } from "@/lib/nutrition";

type Meal = {
  id: number;
  name: string;
  /** Cooked ahead and served by weight — the fit may only resize the serving. */
  batch?: boolean;
  ingredients: BoundedItem[];
};

const KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

/**
 * Preview-and-apply for the portion optimiser.
 *
 * Everything here re-solves live: change a limit, lock a portion, switch the
 * priority, add a filler — the fit updates immediately and nothing is written
 * until Apply.
 */
export function RecalculateDialog({
  meals,
  target,
  dayLabel,
  defaultMode = "balanced",
  onClose,
  onApply,
}: {
  meals: Meal[];
  target: Macros;
  dayLabel?: string;
  defaultMode?: Mode;
  onClose: () => void;
  onApply: (meals: Meal[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Meal[]>(() => structuredClone(meals));
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"portions" | "prep">("portions");

  /**
   * The fit is a whole-day fit. Meals you plate fresh contribute one variable
   * per ingredient; a meal you cooked ahead contributes exactly one — how much
   * of it goes on the plate — because that's the only thing you can actually
   * change once it's in a tray in the fridge.
   */
  const { items: flatItems, slots } = useMemo(() => collapse(draft), [draft]);

  const result = useMemo(
    () => optimisePortions(flatItems, target, { mode }),
    [flatItems, target, mode]
  );

  /** The plan as it would be after applying — used by the prep guide. */
  const fitted = useMemo(
    () => expand(draft, slots, result.grams) as Meal[],
    [draft, slots, result]
  );

  const volume = useMemo(() => dayVolume(fitted), [fitted]);
  const fillers = useMemo(
    () => fillerSuggestions(result.after, target),
    [result.after, target]
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

  /** Forget every hand-set limit and go back to what the food suggests. */
  function resetBounds() {
    setDraft((ms) =>
      ms.map((m) => ({
        ...m,
        ingredients: m.ingredients.map((it) => ({ ...it, min_grams: null, max_grams: null })),
      }))
    );
  }

  /**
   * Take the optimiser up on one of its own suggestions.
   *
   * On a cooked batch the suggestion is about the serving, so it's applied to
   * every component in proportion — widening "the tray" rather than one
   * ingredient inside it, which you couldn't do anyway.
   */
  function applySuggestion(s: Suggestion) {
    const slot = slots[s.index];
    if (!slot) return;
    if (slot.kind === "item") {
      patch(slot.mealId, slot.index, s.direction === "up" ? { max_grams: s.to } : { min_grams: s.to });
      return;
    }
    const scale = slot.baseTotal > 0 ? s.to / slot.baseTotal : 1;
    setDraft((ms) =>
      ms.map((m) =>
        m.id !== slot.mealId
          ? m
          : {
              ...m,
              ingredients: m.ingredients.map((it) => ({
                ...it,
                ...(s.direction === "up"
                  ? { max_grams: Math.round((Number(it.grams) || 0) * scale) }
                  : { min_grams: Math.round((Number(it.grams) || 0) * scale) }),
              })),
            }
      )
    );
  }

  function addFiller(name: string, grams: number, mealId: number) {
    const food = VOLUME_FOODS.find((v) => v.name === name);
    if (!food) return;
    setDraft((ms) =>
      ms.map((m) =>
        m.id !== mealId
          ? m
          : {
              ...m,
              ingredients: [
                ...m.ingredients,
                {
                  name: food.name,
                  grams,
                  kcal_100: food.kcal_100,
                  protein_100: food.protein_100,
                  carbs_100: food.carbs_100,
                  fat_100: food.fat_100,
                  fibre_100: food.fibre_100,
                  min_grams: null,
                  max_grams: null,
                  locked: false,
                },
              ],
            }
      )
    );
  }

  async function apply() {
    setSaving(true);
    await onApply(fitted);
    setSaving(false);
  }

  const missed = KEYS.filter((k) => !result.hit[k]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="card flex max-h-[94vh] w-full max-w-2xl flex-col rounded-b-none sm:rounded-b-[1.25rem]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <div className="mr-auto min-w-0">
            <h2 className="truncate text-lg font-bold tracking-tight">Rebalance portions</h2>
            {dayLabel && <p className="mt-0.5 text-xs text-[var(--color-mut)]">{dayLabel}</p>}
          </div>
          <button className="btn btn-sm btn-quiet px-2.5" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* What matters most */}
        <div className="px-5">
          <Segmented
            size="sm"
            value={mode}
            onChange={(v) => setMode(v)}
            options={MODES.map((m) => ({ value: m.value, label: m.label, hint: m.blurb }))}
          />
          <p className="mt-2 text-xs text-[var(--color-mut)]">
            {MODES.find((m) => m.value === mode)?.blurb}
          </p>
        </div>

        {/* Result */}
        <div className="mt-4 grid grid-cols-2 gap-2 px-5 sm:grid-cols-4">
          {KEYS.map((k) => {
            const after = result.after[k];
            const t = target[k];
            const hit = result.hit[k];
            const delta = Math.round(after - t);
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
                      {delta >= 0 ? "+" : ""}
                      {delta}
                    </span>
                  )}
                  {hit && <span style={{ color: "var(--color-accent)" }}> · on target</span>}
                </p>
              </div>
            );
          })}
        </div>

        {target.fibre > 0 && (
          <p className="mx-5 mt-2 text-xs text-[var(--color-mut)]">
            Fibre{" "}
            <b style={{ color: MACRO_COLOR.fibre }}>{Math.round(result.after.fibre)} g</b> of{" "}
            {Math.round(target.fibre)} g
          </p>
        )}

        {/* Why it couldn't close, and what to do about it */}
        {missed.length > 0 && (
          <div className="mx-5 mt-3 rounded-xl bg-[#2a2416] px-3.5 py-3 text-xs text-[#ffd08a]">
            <p>
              {missed.map((k) => MACRO_LABEL[k].toLowerCase()).join(", ")}{" "}
              {missed.length === 1 ? "is" : "are"} still off.
              {result.unreachable.length > 0
                ? " Your limits can't reach it at all — even at every maximum."
                : " The limits are holding it back."}
            </p>
            {result.suggestions.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {result.suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="btn btn-sm"
                    onClick={() => applySuggestion(s)}
                    title={`Would close ${Math.round(s.closes)} ${s.key === "kcal" ? "kcal" : "g"}`}
                  >
                    {s.direction === "up" ? "Allow up to" : "Allow down to"} {s.to} g of{" "}
                    {s.name.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="mt-4 flex gap-1 px-5">
          {(
            [
              ["portions", "Portions"],
              ["prep", "Meal prep"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? "btn btn-sm btn-accent" : "btn btn-sm btn-quiet"}
            >
              {label}
            </button>
          ))}
          {tab === "portions" && (
            <button className="btn btn-sm btn-quiet ml-auto" onClick={resetBounds}>
              Reset limits
            </button>
          )}
        </div>

        {/* Body */}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5 pb-1">
          {tab === "portions" ? (
            draft.map((meal) => {
              const rows = slots
                .map((slot, gi) => ({ slot, gi }))
                .filter(({ slot }) => slot.mealId === meal.id);
              if (!rows.length) return null;

              return (
                <div key={meal.id} className="mb-5 last:mb-0">
                  <p className="label mb-2">
                    {meal.name}
                    {meal.batch && (
                      <span className="ml-2 normal-case tracking-normal text-[#5b6270]">
                        cooked ahead · served by weight
                      </span>
                    )}
                  </p>
                  <div className="space-y-1.5">
                    {rows.map(({ slot, gi }) =>
                      slot.kind === "batch" ? (
                        <BatchRow
                          key="batch"
                          meal={meal}
                          item={flatItems[gi]}
                          to={result.grams[gi]}
                          binding={result.binding.includes(gi)}
                          onScaleBand={(lo, hi) =>
                            setDraft((ms) =>
                              ms.map((m) =>
                                m.id !== meal.id
                                  ? m
                                  : {
                                      ...m,
                                      ingredients: m.ingredients.map((it) => ({
                                        ...it,
                                        min_grams: Math.round((Number(it.grams) || 0) * lo),
                                        max_grams: Math.round((Number(it.grams) || 0) * hi),
                                      })),
                                    }
                              )
                            )
                          }
                          onLock={(locked) =>
                            setDraft((ms) =>
                              ms.map((m) =>
                                m.id !== meal.id
                                  ? m
                                  : {
                                      ...m,
                                      ingredients: m.ingredients.map((it) => ({ ...it, locked })),
                                    }
                              )
                            )
                          }
                        />
                      ) : (
                        <PortionRow
                          key={slot.index}
                          it={meal.ingredients[slot.index]}
                          from={Number(meal.ingredients[slot.index]?.grams ?? 0)}
                          to={result.grams[gi]}
                          binding={result.binding.includes(gi)}
                          onPatch={(p) => patch(meal.id, slot.index, p)}
                          onRemove={() =>
                            setDraft((ms) =>
                              ms.map((m) =>
                                m.id !== meal.id
                                  ? m
                                  : {
                                      ...m,
                                      ingredients: m.ingredients.filter(
                                        (_, j) => j !== slot.index
                                      ),
                                    }
                              )
                            )
                          }
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <PrepGuide
              volume={volume}
              fillers={fillers}
              meals={draft}
              onAdd={addFiller}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-[#1c1f25] px-5 pb-5 pt-4">
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

/* -------------------------------------------------------------------- */

/**
 * A cooked batch, as one row.
 *
 * There is one number to change — how much of it goes on the plate — and the
 * components underneath are shown at that serving so you know what you're
 * actually eating, not so you can adjust them. That's the honest interface for
 * a tray of food that already exists.
 */
function BatchRow({
  meal,
  item,
  to,
  binding,
  onScaleBand,
  onLock,
}: {
  meal: Meal;
  item: BoundedItem;
  to: number;
  binding: boolean;
  onScaleBand: (lo: number, hi: number) => void;
  onLock: (locked: boolean) => void;
}) {
  const from = servingGrams(meal);
  const scale = from > 0 ? to / from : 1;
  const delta = to - from;
  const b = boundsFor(item);
  const locked = meal.ingredients.every((i) => i.locked);

  return (
    <div className="sunk px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          title={locked ? "Locked — this serving won't move" : "Lock this serving"}
          onClick={() => onLock(!locked)}
          className="shrink-0 rounded-lg p-1 transition hover:bg-white/5"
          style={{ color: locked ? "var(--color-accent)" : "#454b57" }}
        >
          <LockIcon open={!locked} />
        </button>

        <span className="min-w-0 flex-1 basis-[7rem] truncate text-sm font-medium">
          Serving from the batch
        </span>

        <span className="num ml-auto text-sm text-[#545b68]">{Math.round(from)}</span>
        <span className="text-[#454b57]">→</span>
        <span
          className="num w-16 text-right text-sm"
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
            title="Smallest serving you'd accept"
            className="field w-[4.4rem] px-1.5 py-1 text-right text-xs"
            value={Math.round(b.min)}
            disabled={locked}
            onChange={(e) =>
              onScaleBand(
                from > 0 ? Math.max(0.1, Number(e.target.value) / from) : 0.75,
                from > 0 ? b.max / from : 1.35
              )
            }
          />
          <span className="text-xs text-[#454b57]">–</span>
          <input
            type="number"
            title="Largest serving you'd accept"
            className="field w-[4.4rem] px-1.5 py-1 text-right text-xs"
            value={Math.round(b.max)}
            disabled={locked}
            onChange={(e) =>
              onScaleBand(
                from > 0 ? b.min / from : 0.75,
                from > 0 ? Math.max(0.1, Number(e.target.value) / from) : 1.35
              )
            }
          />
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-[0.68rem] text-[#5b6270]">
        <span>
          {meal.ingredients
            .filter((i) => (Number(i.grams) || 0) > 0)
            .map((i) => `${i.name.toLowerCase()} ${Math.round((Number(i.grams) || 0) * scale)}g`)
            .join(" · ")}
        </span>
        {binding && !locked && <span style={{ color: "var(--color-carbs)" }}>at its limit</span>}
      </div>
    </div>
  );
}

function PortionRow({
  it,
  from,
  to,
  binding,
  onPatch,
  onRemove,
}: {
  it: BoundedItem;
  from: number;
  to: number;
  binding: boolean;
  onPatch: (p: Partial<BoundedItem>) => void;
  onRemove: () => void;
}) {
  const b = boundsFor(it);
  const unit = unitOf(it);
  const smart = smartBounds(it.name, from, it);
  const custom = it.min_grams != null || it.max_grams != null;
  const delta = to - from;

  return (
    <div className="sunk px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          title={it.locked ? "Locked — this portion won't move" : "Lock this portion"}
          onClick={() => onPatch({ locked: !it.locked })}
          className="shrink-0 rounded-lg p-1 transition hover:bg-white/5"
          style={{ color: it.locked ? "var(--color-accent)" : "#454b57" }}
        >
          <LockIcon open={!it.locked} />
        </button>

        <span
          className="min-w-0 flex-1 basis-[8rem] truncate text-sm font-medium"
          style={it.locked ? { color: "var(--color-mut)" } : undefined}
        >
          {it.name}
        </span>

        <span className="num ml-auto text-sm text-[#545b68]">{Math.round(from)}</span>
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
            value={it.min_grams ?? Math.round(b.min)}
            disabled={it.locked}
            onChange={(e) => onPatch({ min_grams: Number(e.target.value) })}
          />
          <span className="text-xs text-[#454b57]">–</span>
          <input
            type="number"
            title="Largest portion you'd accept"
            className="field w-[3.9rem] px-1.5 py-1 text-right text-xs"
            value={it.max_grams ?? Math.round(b.max)}
            disabled={it.locked}
            onChange={(e) => onPatch({ max_grams: Number(e.target.value) })}
          />
        </span>

        <button
          className="px-1 text-[#4a505c] transition hover:text-[var(--color-fat)]"
          title="Take this out of the plan"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>

      {/* What the app knows about this food, and why the band is what it is. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-[0.68rem] text-[#5b6270]">
        <span>{smart.profile.spec.label.toLowerCase()}</span>
        {unit && (
          <span style={{ color: "var(--color-protein)" }}>
            {(to / unit.grams).toFixed(1).replace(/\.0$/, "")} {unit.name}
            {to / unit.grams === 1 ? "" : "s"} · whole units only
          </span>
        )}
        {smart.profile.rawToCooked !== 1 && (
          <span>
            ≈ {Math.round(to * smart.profile.rawToCooked)} g cooked
          </span>
        )}
        {binding && !it.locked && (
          <span style={{ color: "var(--color-carbs)" }}>at its limit</span>
        )}
        {custom && !it.locked && (
          <button
            className="underline decoration-dotted"
            onClick={() => onPatch({ min_grams: null, max_grams: null })}
          >
            reset to suggested ({Math.round(smart.min)}–{Math.round(smart.max)} g)
          </button>
        )}
      </div>
    </div>
  );
}

function PrepGuide({
  volume,
  fillers,
  meals,
  onAdd,
}: {
  volume: ReturnType<typeof dayVolume>;
  fillers: ReturnType<typeof fillerSuggestions>;
  meals: Meal[];
  onAdd: (name: string, grams: number, mealId: number) => void;
}) {
  const [mealId, setMealId] = useState<number>(meals[0]?.id ?? 0);

  return (
    <div className="space-y-4 pb-2">
      <div className="sunk px-4 py-3.5">
        <p className="label">How much food this actually is</p>
        <p className="mt-2 text-sm leading-relaxed">{volumeHeadline(volume)}</p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
          Energy density is the number that decides whether a day fills you up. Under about
          150 kcal per 100 g you'll finish the day full; over 250 and you'll be hungry on the
          same calories.
        </p>
      </div>

      {volume.meals.map((m) => (
        <div key={m.name} className="sunk px-4 py-3">
          <div className="flex items-baseline gap-2">
            <p className="mr-auto text-sm font-semibold">{m.name}</p>
            <span className="num text-sm" style={{ color: "var(--color-accent)" }}>
              {Math.round(m.cookedGrams)} g
            </span>
            <span className="text-xs text-[var(--color-mut)]">
              {Math.round(m.kcalPer100g)} kcal/100g
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--color-mut)" }}>
            {m.verdict} — {m.blurb}
          </p>
          {m.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[#5b6270]">
              {m.notes.slice(0, 4).map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {fillers.length > 0 && (
        <div className="sunk px-4 py-3.5">
          <p className="label">Calories spare</p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
            There's room left in the day. These add the most food for the fewest calories — pick a
            meal and add one, and the fit will re-run around it.
          </p>
          <div className="mt-3">
            <select
              className="field w-full text-sm"
              value={mealId}
              onChange={(e) => setMealId(Number(e.target.value))}
            >
              {meals.map((m) => (
                <option key={m.id} value={m.id}>
                  Add to {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 space-y-1.5">
            {fillers.map((f) => (
              <div key={f.name} className="flex items-center gap-2">
                <span className="mr-auto text-sm">
                  {f.grams} g {f.name.toLowerCase()}
                </span>
                <span className="text-xs text-[var(--color-mut)]">{f.reason}</span>
                <button className="btn btn-sm" onClick={() => onAdd(f.name, f.grams, mealId)}>
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
