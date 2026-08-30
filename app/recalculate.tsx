"use client";

import { useMemo, useState } from "react";
import { MACRO_COLOR, MACRO_LABEL, Segmented } from "./macro-ui";
import {
  boundsFor,
  unitOf,
  MODES,
  type BoundedItem,
  type DayResult,
  type Mode,
  type ShareOutcome,
  type Suggestion,
} from "@/lib/optimise";
import { smartBounds, VOLUME_FOODS } from "@/lib/foods";
import { dayVolume, fillerSuggestions, volumeHeadline } from "@/lib/prep";
import { servingGrams, type PlanMeal } from "@/lib/batch";
import { fitWeek, mealGroups, repsOf } from "@/lib/weekfit";
import type { WeekPlan } from "@/lib/nutrition";
import type { Supplement } from "@/lib/supplements";

/**
 * Rebalance the week.
 *
 * One press, one answer. The portions are the same every day because they come
 * out of the same containers; what changes is which meals are on the menu. So
 * there is nothing to choose a day for and nothing to run five times — the fit
 * lands every kind of day at once, and the table at the top says whether it
 * did.
 *
 * Everything here re-solves live: change a limit, lock a portion, set a split,
 * switch what matters most — the answer updates as you type and nothing is
 * written until Apply.
 */
export function RecalculateDialog({
  meals,
  plan,
  supplements = [],
  defaultMode = "balanced",
  onClose,
  onApply,
}: {
  meals: PlanMeal[];
  plan: WeekPlan;
  /**
   * Counted toward every day and never resized. Passing them in matters even
   * when they're all zero-macro: the Plan page's headline already includes
   * them, and a dialog that didn't would quietly disagree with the page that
   * opened it the moment anything with calories in it went on the list.
   */
  supplements?: Supplement[];
  defaultMode?: Mode;
  onClose: () => void;
  onApply: (meals: PlanMeal[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PlanMeal[]>(() => structuredClone(meals));
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"days" | "splits" | "portions" | "prep">("days");
  /**
   * Which meal's internal split is open, if any.
   *
   * Closed by default: most meals are a recipe rather than a ratio, and a
   * per-cent box under every one of them asks you to have an opinion about
   * how much of your dinner is rice. A meal you have already set shares on
   * opens straight away, because that one you clearly do.
   */
  const [splitOpen, setSplitOpen] = useState<number | null>(
    () => meals.find((m) => m.ingredients.some((it) => it.share_pct != null))?.id ?? null
  );

  const result = useMemo(
    () => fitWeek(draft, plan, { mode, supplements }),
    [draft, plan, mode, supplements]
  );

  const live = result.days.filter((d) => d.weight > 0);
  const unused = result.days.filter((d) => d.weight === 0);
  const groups = useMemo(
    () => mealGroups(draft, plan.order.length).filter((g) => g.meals.length > 1),
    [draft, plan.order.length]
  );

  /**
   * What each group's split actually came out as.
   *
   * Read off the fitted plan rather than the solver's share report, because
   * the report only covers groups you have set a share on — and a box with no
   * number beside it tells you nothing about what you are changing.
   */
  const splitOf = useMemo(() => {
    const out = new Map<number, number>();
    const kcalOf = (id: number) => {
      const m = result.meals.find((x) => x.id === id);
      if (!m) return 0;
      return m.ingredients.reduce(
        (a, i) => a + ((Number(i.grams) || 0) * (Number(i.kcal_100) || 0)) / 100,
        0
      ) * repsOf(m);
    };
    for (const g of groups) {
      const ks = g.meals.map((m) => kcalOf(m.id));
      const total = ks.reduce((a, b) => a + b, 0);
      g.meals.forEach((m, i) => out.set(m.id, total > 0 ? ks[i] / total : 0));
    }
    return out;
  }, [groups, result.meals]);

  /** What each meal's own ingredients came out at, as a share of that meal. */
  const ingredientSplit = useMemo(() => {
    const out = new Map<number, Map<number, number>>();
    for (const m of result.meals) {
      if (m.ingredients.length < 2) continue;
      const ks = m.ingredients.map(
        (i) => ((Number(i.grams) || 0) * (Number(i.kcal_100) || 0)) / 100
      );
      const total = ks.reduce((a, b) => a + b, 0);
      const inner = new Map<number, number>();
      ks.forEach((k, i) => inner.set(i, total > 0 ? k / total : 0));
      out.set(m.id, inner);
    }
    return out;
  }, [result.meals]);

  const volume = useMemo(() => dayVolume(result.meals), [result.meals]);
  const fillers = useMemo(
    () => fillerSuggestions(result.weekly.after, result.weekly.target),
    [result.weekly]
  );

  const slotOf = (gi: number) => result.fit.slots[gi];

  function patchMeal(mealId: number, p: Partial<PlanMeal>) {
    setDraft((ms) => ms.map((m) => (m.id === mealId ? { ...m, ...p } : m)));
  }

  function patchItem(mealId: number, index: number, p: Partial<BoundedItem>) {
    setDraft((ms) =>
      ms.map((m) =>
        m.id !== mealId
          ? m
          : { ...m, ingredients: m.ingredients.map((it, i) => (i === index ? { ...it, ...p } : it)) }
      )
    );
  }

  /** Scale every portion in a meal's band together — the honest move for a tray. */
  function scaleBand(mealId: number, lo: number, hi: number) {
    setDraft((ms) =>
      ms.map((m) =>
        m.id !== mealId
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
    );
  }

  function resetBounds() {
    setDraft((ms) =>
      ms.map((m) => ({
        ...m,
        ingredients: m.ingredients.map((it) => ({ ...it, min_grams: null, max_grams: null })),
      }))
    );
  }

  function applySuggestion(s: Suggestion) {
    const slot = slotOf(s.index);
    if (!slot) return;
    if (slot.kind === "item") {
      patchItem(slot.mealId, slot.index, s.direction === "up" ? { max_grams: s.to } : { min_grams: s.to });
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

  /**
   * Widen whatever is in the way of the split you asked for.
   *
   * A meal's share is blocked by the meal as a whole, so its band moves in
   * proportion. An ingredient's share is blocked by that one ingredient, so
   * only its limit moves — widening its neighbours would be answering a
   * question nobody asked.
   */
  function unblockShare(s: ShareOutcome) {
    const meal = draft.find((m) => m.id === s.mealId);
    if (!meal || !s.suggestGrams) return;

    const dot = s.name.indexOf(" · ");
    if (dot >= 0) {
      const ingName = s.name.slice(dot + 3);
      const index = meal.ingredients.findIndex((it) => it.name === ingName);
      if (index < 0) return;
      patchItem(
        meal.id,
        index,
        s.blocked === "min"
          ? { min_grams: Math.max(0, Math.floor(s.suggestGrams)) }
          : { max_grams: Math.ceil(s.suggestGrams) }
      );
      return;
    }

    const base = servingGrams(meal) || 1;
    const k = s.suggestGrams / base;
    setDraft((ms) =>
      ms.map((m) =>
        m.id !== s.mealId
          ? m
          : {
              ...m,
              ingredients: m.ingredients.map((it) => {
                const g = Number(it.grams) || 0;
                return s.blocked === "min"
                  ? { ...it, min_grams: Math.max(0, Math.floor(g * k)) }
                  : { ...it, max_grams: Math.ceil(g * k) };
              }),
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
    // The shares you set here are part of the answer, so they are saved with it.
    await onApply(
      result.meals.map((m) => {
        const d = draft.find((x) => x.id === m.id);
        return {
          ...m,
          share_pct: d?.share_pct ?? null,
          ingredients: m.ingredients.map((it, i) => ({
            ...it,
            share_pct: d?.ingredients[i]?.share_pct ?? null,
          })),
        };
      })
    );
    setSaving(false);
  }

  const offDays = live.filter((d) => !d.hit.kcal);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="card flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-b-none sm:max-h-[88dvh] sm:rounded-b-[1.25rem]">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <div className="mr-auto min-w-0">
            <h2 className="truncate text-lg font-bold tracking-tight">Rebalance the week</h2>
            <p className="mt-0.5 text-xs text-[var(--color-mut)]">
              One set of portions, fitted to every kind of day at once
            </p>
          </div>
          <button className="btn btn-sm btn-quiet px-2.5" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Headline: does the week work? */}
        <div className="mx-5 mt-1 flex items-baseline gap-3 rounded-xl bg-[#0e1013] px-4 py-3">
          <span className="label mr-auto">Week average</span>
          <span className="num text-2xl" style={{ color: MACRO_COLOR.kcal }}>
            {Math.round(result.weekly.after.kcal).toLocaleString()}
          </span>
          <Delta
            value={result.weekly.after.kcal - result.weekly.target.kcal}
            tol={Math.max(20, result.weekly.target.kcal * 0.01)}
          />
        </div>

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap gap-1 px-5 pb-1">
          {(
            [
              ["days", "Every day"],
              ["splits", groups.length ? "Splits" : ""],
              ["portions", "Portions"],
              ["prep", "Meal prep"],
            ] as const
          )
            .filter(([, label]) => label)
            .map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={tab === id ? "btn btn-sm btn-accent" : "btn btn-sm btn-quiet"}
              >
                {label}
              </button>
            ))}
        </div>

        {/* Body */}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5 pb-1">
          {tab === "days" && (
            <div className="space-y-2 pb-2">
              {live.map((d) => (
                <DayCard key={d.id} day={d} />
              ))}

              {unused.length > 0 && (
                <p className="pt-1 text-xs leading-relaxed text-[var(--color-mut)]">
                  {unused.map((d) => d.name).join(", ")}{" "}
                  {unused.length === 1 ? "isn't" : "aren't"} on any weekday, so{" "}
                  {unused.length === 1 ? "it wasn't" : "they weren't"} fitted. Put{" "}
                  {unused.length === 1 ? "it" : "one"} in your week on the Plan page if you want the
                  portions to allow for {unused.length === 1 ? "it" : "them"}.
                </p>
              )}

              {offDays.length > 0 && result.suggestions.length > 0 && (
                <div className="mt-3 rounded-xl bg-[#2a2416] px-3.5 py-3 text-xs text-[#ffd08a]">
                  <p className="leading-relaxed">
                    The portion limits are what&rsquo;s holding{" "}
                    {offDays.map((d) => d.name.toLowerCase()).join(" and ")} back. Any of these
                    would help:
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {result.suggestions.map((s, i) => (
                      <button key={i} className="btn btn-sm" onClick={() => applySuggestion(s)}>
                        {s.direction === "up" ? "Allow up to" : "Allow down to"} {s.to} g of{" "}
                        {s.name.toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2">
                <p className="label mb-2">What matters most</p>
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
            </div>
          )}

          {tab === "splits" && (
            <div className="space-y-4 pb-2">
              <p className="text-xs leading-relaxed text-[var(--color-mut)]">
                This is plan-building. Nothing in the day&rsquo;s targets says how to divide meals
                that always appear together, so these say what you want and the fit holds it.
                Figures are shares of the <b>calories</b>. It shapes the plan you cook to — logging
                what you ate is untouched by any of it.
              </p>

              {/* Between meals that come and go together */}
              {groups.map((g) => (
                <div key={g.key} className="sunk px-4 py-3.5">
                  {/* Sentence case, not the uppercase label style — a list of
                      three day-type names in caps is a wall, not a heading. */}
                  <p className="text-xs font-semibold text-[var(--color-mut)]">
                    {g.dayTypeIds
                      ? `Only on ${dayList(g.dayTypeIds, result.days)} days`
                      : "Eaten every day"}
                  </p>
                  <div className="mt-3 space-y-2.5">
                    {g.meals.map((m) => (
                      <ShareRow
                        key={m.id}
                        name={m.name}
                        value={draft.find((d) => d.id === m.id)?.share_pct ?? null}
                        got={splitOf.get(m.id) ?? 0}
                        outcome={result.shares.find((s) => s.mealId === m.id && s.name === m.name)}
                        onChange={(v) => patchMeal(m.id, { share_pct: v })}
                        onUnblock={unblockShare}
                      />
                    ))}
                  </div>
                  <p className="mt-2.5 text-[0.7rem] text-[var(--color-mut)]">
                    Leave a box empty to let the fit decide that one.
                  </p>
                </div>
              ))}

              {/* Inside one meal — opt in, because most meals aren't like that */}
              <div className="sunk px-4 py-3.5">
                <p className="text-xs font-semibold text-[var(--color-mut)]">Inside a meal</p>
                <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[var(--color-mut)]">
                  Some meals you balance deliberately — a yoghurt bowl you want half yoghurt rather
                  than half granola. Most you don&rsquo;t: chicken and rice is a recipe, not a
                  ratio. Open one only if it&rsquo;s the first kind.
                </p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {draft
                    .filter((m) => m.ingredients.length > 1)
                    .map((meal) => {
                      const set = meal.ingredients.some((it) => it.share_pct != null);
                      const open = splitOpen === meal.id;
                      return (
                        <button
                          key={meal.id}
                          onClick={() => setSplitOpen(open ? null : meal.id)}
                          className={open || set ? "btn btn-sm btn-accent" : "btn btn-sm"}
                        >
                          {meal.name}
                          {set && " ·"}
                        </button>
                      );
                    })}
                </div>

                {(() => {
                  const meal = draft.find((m) => m.id === splitOpen);
                  if (!meal) return null;
                  const inner = ingredientSplit.get(meal.id) ?? new Map<number, number>();
                  return (
                    <div className="mt-4 border-t border-[#1c1f25] pt-3.5">
                      <div className="flex items-baseline gap-2">
                        <p className="mr-auto text-sm font-semibold">{meal.name}</p>
                        {meal.ingredients.some((it) => it.share_pct != null) && (
                          <button
                            className="text-[0.7rem] text-[var(--color-mut)] underline decoration-dotted"
                            onClick={() =>
                              meal.ingredients.forEach((_, i) =>
                                patchItem(meal.id, i, { share_pct: null })
                              )
                            }
                          >
                            clear
                          </button>
                        )}
                      </div>
                      <div className="mt-3 space-y-2.5">
                        {meal.ingredients.map((it, i) => (
                          <ShareRow
                            key={i}
                            name={it.name}
                            value={it.share_pct ?? null}
                            got={inner.get(i) ?? 0}
                            outcome={result.shares.find(
                              (s) => s.name === `${meal.name} · ${it.name}`
                            )}
                            onChange={(v) => patchItem(meal.id, i, { share_pct: v })}
                            onUnblock={unblockShare}
                          />
                        ))}
                      </div>
                      <p className="mt-2.5 text-[0.7rem] leading-relaxed text-[var(--color-mut)]">
                        {meal.batch
                          ? "Cooked ahead, so this is the recipe rather than a preference — the amounts are re-proportioned to match and the whole tray is then sized to fit the day."
                          : "Leave a box empty to let the fit decide that one."}
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {tab === "portions" && (
            <div className="pb-2">
              <div className="mb-3 flex items-center gap-2">
                <p className="mr-auto text-xs leading-relaxed text-[var(--color-mut)]">
                  Each portion is the same every day. Lock one to pin it.
                </p>
                <button className="btn btn-sm btn-quiet shrink-0" onClick={resetBounds}>
                  Reset limits
                </button>
              </div>
              {draft.map((meal) => {
                const rows = result.fit.slots
                  .map((slot, gi) => ({ slot, gi }))
                  .filter(({ slot }) => slot.mealId === meal.id);
                if (!rows.length) return null;
                const on = meal.day_type_ids?.length
                  ? meal.day_type_ids
                      .map((id) => result.days.find((d) => d.id === id)?.name ?? "")
                      .filter(Boolean)
                  : null;

                return (
                  <div key={meal.id} className="mb-5 last:mb-0">
                    <p className="label mb-2">
                      {meal.name}
                      <span className="ml-2 normal-case tracking-normal text-[#5b6270]">
                        {on ? on.join(", ").toLowerCase() : "every day"}
                        {repsOf(meal) > 1 ? ` · ${repsOf(meal)}× a day` : ""}
                        {meal.batch ? " · cooked ahead" : ""}
                      </span>
                    </p>
                    <div className="space-y-1.5">
                      {rows.map(({ slot, gi }) =>
                        slot.kind === "batch" ? (
                          <BatchRow
                            key="batch"
                            meal={meal}
                            item={result.fit.items[gi]}
                            to={result.grams[gi]}
                            binding={result.binding.includes(gi)}
                            onScaleBand={(lo, hi) => scaleBand(meal.id, lo, hi)}
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
                            onPatch={(p) => patchItem(meal.id, slot.index, p)}
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
              })}
            </div>
          )}

          {tab === "prep" && (
            <PrepGuide volume={volume} fillers={fillers} meals={draft} onAdd={addFiller} />
          )}
        </div>

        {/* Footer */}
        <div className="safe-b flex gap-2 border-t border-[#1c1f25] px-5 pt-4">
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
 * One share: what you want of it, and what it actually came out as.
 *
 * The same row serves a meal's share of its group and an ingredient's share of
 * its meal, because they are the same question asked one level apart, and
 * showing them differently would only suggest they behave differently.
 */
function ShareRow({
  name,
  value,
  got,
  outcome,
  onChange,
  onUnblock,
}: {
  name: string;
  value: number | null;
  got: number;
  outcome?: ShareOutcome;
  onChange: (v: number | null) => void;
  onUnblock: (s: ShareOutcome) => void;
}) {
  // Three points either way is inside the noise of rounding a portion to
  // something you can weigh; past that the difference is real.
  const missed = value != null && Math.abs(got - value / 100) > 0.03;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto min-w-0 flex-1 basis-20 truncate text-sm font-medium">{name}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          placeholder="auto"
          aria-label={`${name} share of the calories, per cent`}
          className="field w-[3.9rem] px-2 py-1.5 text-right text-sm"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
        <span className="text-xs text-[var(--color-mut)]">%</span>
        <span className="shrink-0 text-[#454b57]">→</span>
        <span
          className="num w-12 shrink-0 text-right text-sm"
          title="What it actually came out as"
          style={{
            color: outcome?.blocked
              ? "var(--color-carbs)"
              : missed
                ? "var(--color-mut)"
                : "var(--color-accent)",
          }}
        >
          {Math.round(got * 100)}%
        </span>
      </div>
      {outcome?.blocked ? (
        <button
          className="mt-1.5 text-left text-[0.7rem] leading-relaxed text-[#ffd08a] underline decoration-dotted"
          onClick={() => onUnblock(outcome)}
        >
          Held at its {outcome.blocked === "min" ? "smallest" : "largest"} allowed size — tap to
          allow {outcome.suggestGrams} g and reach {Math.round(outcome.want * 100)}%
        </button>
      ) : (
        // Not every miss is a limit. Once nothing is pinned, a share that still
        // hasn't landed is the macros disagreeing — and saying so is better
        // than leaving a typed 50 sitting next to a 43% with no explanation.
        missed && (
          <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[#5b6270]">
            Nothing&rsquo;s in the way — the macros land closer at {Math.round(got * 100)}%. Lock a
            portion, or narrow its limits, to insist.
          </p>
        )
      )}
    </div>
  );
}

/** "swim only and swim + gym" — a list a person would say out loud. */
function dayList(ids: number[], days: { id: number; name: string }[]): string {
  const names = ids
    .map((id) => days.find((d) => d.id === id)?.name.toLowerCase() ?? "")
    .filter(Boolean);
  if (names.length <= 1) return names[0] ?? "these";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * How far off, and whether to care.
 *
 * The figure is always shown. Replacing it with the word "on target" inside
 * the tolerance looked tidier and threw away the thing you came to read —
 * being 8 kcal out and being 60 kcal out are both fine, and they are not the
 * same. The colour carries the verdict; the number carries the fact.
 */
function Delta({ value, tol }: { value: number; tol: number }) {
  const ok = Math.abs(value) <= tol;
  const v = Math.round(value);
  return (
    <span
      className="w-16 shrink-0 text-right text-sm font-bold tabular-nums"
      style={{ color: ok ? "var(--color-accent)" : "var(--color-carbs)" }}
      title={ok ? "Within a fifty-per-cent-of-nothing tolerance — this is fine" : "Off target"}
    >
      {v >= 0 ? "+" : ""}
      {v}
    </span>
  );
}

/**
 * One kind of day: what it should be, what it will be, and by how much it
 * misses. The calorie line leads because that is the one that decides the
 * outcome; the macros sit underneath for when you want them.
 */
function DayCard({ day }: { day: DayResult }) {
  return (
    <div className="sunk px-4 py-3">
      <div className="flex items-baseline gap-2">
        <span className="mr-auto text-sm font-semibold">{day.name}</span>
        <span className="text-[0.7rem] text-[var(--color-mut)]">
          {day.weight} {day.weight === 1 ? "day" : "days"} a week
        </span>
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="num text-xl" style={{ color: MACRO_COLOR.kcal }}>
          {Math.round(day.after.kcal).toLocaleString()}
        </span>
        <span className="text-xs text-[var(--color-mut)]">
          of {Math.round(day.target.kcal).toLocaleString()} kcal
        </span>
        <span className="ml-auto">
          <Delta value={day.residual.kcal} tol={Math.max(2, day.target.kcal * 0.02)} />
        </span>
      </div>

      <div className="scroll-x mt-2 flex gap-x-4 text-[0.7rem] tabular-nums">
        {(["protein", "carbs", "fat"] as const).map((k) => (
          <span key={k} className="whitespace-nowrap">
            <span style={{ color: MACRO_COLOR[k] }}>{MACRO_LABEL[k]}</span>{" "}
            <b>{Math.round(day.after[k])}</b>
            <span className="text-[var(--color-mut)]">/{Math.round(day.target[k])}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

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
  meal: PlanMeal;
  item: BoundedItem;
  to: number;
  binding: boolean;
  onScaleBand: (lo: number, hi: number) => void;
  onLock: (locked: boolean) => void;
}) {
  const from = servingGrams(meal);
  const scale = from > 0 ? to / from : 1;
  const b = boundsFor(item);
  const locked = meal.ingredients.every((i) => i.locked);

  return (
    <div className="sunk px-3 py-2.5">
      <div className="flex items-center gap-2">
        <LockButton locked={locked} onClick={() => onLock(!locked)} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Serving from the batch</span>
        <Change from={from} to={to} />
      </div>

      <div className="mt-2 flex items-center gap-2 pl-8">
        <span className="text-[0.68rem] text-[#5b6270]">between</span>
        <Limits
          min={Math.round(b.min)}
          max={Math.round(b.max)}
          disabled={locked}
          onMin={(v) => onScaleBand(from > 0 ? Math.max(0.1, v / from) : 0.75, from > 0 ? b.max / from : 1.35)}
          onMax={(v) => onScaleBand(from > 0 ? b.min / from : 0.75, from > 0 ? Math.max(0.1, v / from) : 1.35)}
        />
        <span className="text-[0.68rem] text-[#5b6270]">g</span>
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

  return (
    <div className="sunk px-3 py-2">
      {/* What it is, and what it becomes */}
      <div className="flex items-center gap-2">
        <LockButton locked={!!it.locked} onClick={() => onPatch({ locked: !it.locked })} />
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          style={it.locked ? { color: "var(--color-mut)" } : undefined}
        >
          {it.name}
        </span>
        <Change from={from} to={to} />
      </div>

      {/* The band it may move in. Its own line: the boxes are 16px on a phone
          because anything smaller makes iOS zoom the page, and three controls
          at that size do not share a line with a name and two figures. */}
      <div className="mt-2 flex items-center gap-2 pl-8">
        <span className="text-[0.68rem] text-[#5b6270]">between</span>
        <Limits
          min={it.min_grams ?? Math.round(b.min)}
          max={it.max_grams ?? Math.round(b.max)}
          disabled={!!it.locked}
          onMin={(v) => onPatch({ min_grams: v })}
          onMax={(v) => onPatch({ max_grams: v })}
        />
        <span className="text-[0.68rem] text-[#5b6270]">g</span>
        <button
          className="ml-auto px-1 text-[#4a505c] transition hover:text-[var(--color-fat)]"
          title="Take this out of the plan"
          aria-label={`Remove ${it.name}`}
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
        {smart.profile.rawToCooked !== 1 && <span>≈ {Math.round(to * smart.profile.rawToCooked)} g cooked</span>}
        {binding && !it.locked && <span style={{ color: "var(--color-carbs)" }}>at its limit</span>}
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

/** Old amount, arrow, new amount — coloured by which way it went. */
function Change({ from, to }: { from: number; to: number }) {
  const delta = to - from;
  return (
    <span className="ml-auto flex items-center gap-1.5">
      <span className="num text-sm text-[#545b68]">{Math.round(from)}</span>
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
    </span>
  );
}

/** The band a portion may move in. Two boxes, wide enough for four digits. */
function Limits({
  min,
  max,
  disabled,
  onMin,
  onMax,
}: {
  min: number;
  max: number;
  disabled: boolean;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        aria-label="Smallest portion you would accept"
        title="Smallest portion you'd accept"
        className="field w-[4.2rem] px-2 py-1 text-right text-xs"
        value={min}
        disabled={disabled}
        onChange={(e) => onMin(Number(e.target.value))}
      />
      <span className="text-xs text-[#454b57]">–</span>
      <input
        type="number"
        inputMode="numeric"
        aria-label="Largest portion you would accept"
        title="Largest portion you'd accept"
        className="field w-[4.2rem] px-2 py-1 text-right text-xs"
        value={max}
        disabled={disabled}
        onChange={(e) => onMax(Number(e.target.value))}
      />
    </span>
  );
}

function LockButton({ locked, onClick }: { locked: boolean; onClick: () => void }) {
  return (
    <button
      title={locked ? "Locked — this portion won't move" : "Lock this portion"}
      aria-label={locked ? "Unlock this portion" : "Lock this portion"}
      aria-pressed={locked}
      onClick={onClick}
      className="shrink-0 rounded-lg p-1.5 transition hover:bg-white/5"
      style={{ color: locked ? "var(--color-accent)" : "#454b57" }}
    >
      <LockIcon open={!locked} />
    </button>
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
  meals: PlanMeal[];
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
          150 kcal per 100 g you&rsquo;ll finish the day full; over 250 and you&rsquo;ll be hungry
          on the same calories.
        </p>
      </div>

      {volume.meals.map((m) => (
        <div key={m.name} className="sunk px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
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
            There&rsquo;s room left in the average day. These add the most food for the fewest
            calories — pick a meal and add one, and the fit will re-run around it.
          </p>
          <div className="mt-3">
            <select
              className="field w-full text-sm"
              aria-label="Which meal to add it to"
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
              <div key={f.name} className="flex flex-wrap items-center gap-2">
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
