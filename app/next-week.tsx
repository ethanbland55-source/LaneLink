"use client";

import { overlayPending, type PendingPortion } from "@/lib/pending";
import { totalFor, type Review, type ReviewLimit } from "@/lib/nutrition";
import { Note } from "./explain";

type Item = { name: string; grams: number; kcal_100: number; protein_100: number; carbs_100: number; fat_100: number };
type Meal = { id: number; name: string; ingredients: Item[] };

const TONE: Record<Review["tone"], string> = {
  good: "var(--color-accent)",
  watch: "var(--color-carbs)",
  bad: "var(--color-fat)",
  neutral: "var(--color-fg, #f2f4f7)",
};

function day(d: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", opts);
}

function eveOf(d: string): string {
  const x = new Date(d + "T12:00:00");
  x.setDate(x.getDate() - 1);
  return x.toLocaleDateString("en-GB", { weekday: "long" });
}

const g = (n: number) => `${Math.round(n)}`;

/**
 * Next week, in full, before it happens.
 *
 * This replaced a one-line "12 portions change on Monday" with the list folded
 * away behind a disclosure — which said a change was coming and hid what it
 * was. Ethan: *"it hides elements and you can't really see it properly."* The
 * whole point of deciding on Friday is that you can look at next week before
 * you shop for it and before you cook it, so every meal is here, every food in
 * it, what it was and what it becomes, with the ones that move picked out and
 * the ones that don't left quiet — the unchanged rows are part of the answer,
 * because "the rest of breakfast stays as it is" is something you need to know
 * too.
 *
 * Above the meals: why, in one line, and the day's numbers before and after.
 */
export function NextWeek({
  review,
  pending,
  meals,
  applyOn,
  onDiscard,
  onLoosen,
  busy,
}: {
  review: Review | null;
  pending: PendingPortion[];
  meals: Meal[];
  applyOn: string;
  onDiscard: () => void;
  onLoosen: (l: ReviewLimit) => void;
  busy: boolean;
}) {
  const changes = pending.length;
  const eve = eveOf(applyOn);
  const when = `${day(applyOn, { weekday: "short", day: "numeric", month: "short" })}`;
  const tone = review ? TONE[review.tone] : "var(--color-carbs)";
  const quiet = !!review && (review.dismissed || (!review.moving && changes === 0));

  const rows = meals
    .filter((m) => m.ingredients.length > 0)
    .map((m) => {
      const next = overlayPending(m.id, m.ingredients, pending);
      const was = totalFor(m.ingredients as any).kcal;
      const now = totalFor(next as any).kcal;
      return {
        meal: m,
        was,
        now,
        items: m.ingredients.map((it, i) => ({ name: it.name, from: it.grams, to: next[i].grams })),
      };
    });

  const from = review?.from;
  const to = review?.to;
  const diff = from && to ? to.kcal - from.kcal : 0;

  return (
    <section
      className="card px-5 py-5"
      style={{ border: `1px solid color-mix(in srgb, ${tone} 35%, transparent)` }}
      aria-label="Next week's plan"
    >
      <div className="flex items-baseline gap-2">
        <p className="label mr-auto">Next week</p>
        <p className="text-xs text-[var(--color-mut)]">from {when}</p>
      </div>

      <p className="mt-2 text-base font-bold leading-snug" style={{ color: tone }}>
        {review ? review.headline : "A rebalance you staged"}
      </p>

      {review && !review.dismissed && review.moving && (
        <p className="num mt-1 text-sm">
          {review.stepKcal > 0 ? "+" : "−"}
          {Math.abs(review.stepKcal)} kcal a day
          {review.decisive && (
            <span className="ml-2 rounded-full bg-[var(--color-raised)] px-2 py-0.5 align-middle text-[0.68rem] font-semibold text-[var(--color-mut)]">
              the one-off recomp cut
            </span>
          )}
        </p>
      )}

      {review && !review.dismissed && !review.moving && changes > 0 && (
        <p className="mt-1 text-sm">
          Calories hold — {changes} portion{changes === 1 ? "" : "s"} re-fitted to land on target
        </p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
        {quiet
          ? `No portions change. Next week is this week again.`
          : `Comes in on ${eve} evening as soon as all of ${eve}'s meals are ticked off — so what you cook that night is next week's — or first thing ${day(applyOn, { weekday: "long" })} if not. The shopping list is already buying for it.`}
      </p>

      {/* The day before and after — the numbers the portions are fitted to. */}
      {from && to && !quiet && (
        <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl bg-[#0e1013] px-3 py-3">
          {(
            [
              ["kcal", "Calories", from.kcal, to.kcal, ""],
              ["protein", "Protein", from.protein, to.protein, " g"],
              ["carbs", "Carbs", from.carbs, to.carbs, " g"],
              ["fat", "Fat", from.fat, to.fat, " g"],
            ] as const
          ).map(([k, label, a, b, unit]) => (
            <div key={k} className="min-w-0">
              <p className="text-[0.66rem] uppercase tracking-wide text-[var(--color-mut)]">{label}</p>
              <p className="num mt-1 text-[0.72rem] text-[var(--color-mut)] line-through decoration-[#454b57]">
                {a.toLocaleString()}
                {unit}
              </p>
              <p
                className="num text-sm font-bold"
                style={{ color: b === a ? "var(--color-mut)" : "var(--color-fg, #f2f4f7)" }}
              >
                {b.toLocaleString()}
                {unit}
              </p>
            </div>
          ))}
        </div>
      )}
      {from && to && !quiet && (
        <p className="mt-2 text-[0.72rem] leading-relaxed text-[var(--color-mut)]">
          Daily average, {diff >= 0 ? "+" : "−"}
          {Math.abs(diff)} kcal. Protein {from.proteinPerKg.toFixed(2)}
          {to.proteinPerKg !== from.proteinPerKg ? ` → ${to.proteinPerKg.toFixed(2)}` : ""} g per kg
          {to.proteinBasis === "lean" ? " of lean mass" : ""}; fat {from.fatPerKg.toFixed(2)}
          {to.fatPerKg !== from.fatPerKg ? ` → ${to.fatPerKg.toFixed(2)}` : ""} g per kg.
          {review?.landsKcal != null && Math.abs(review.landsKcal - to.kcal) > 30
            ? ` The portions come to ${review.landsKcal.toLocaleString()} — ${review.landsKcal > to.kcal ? "over" : "under"} by ${Math.abs(review.landsKcal - to.kcal)}, because of the limits below.`
            : ""}
        </p>
      )}

      {/* Every meal, every food — nothing folded away. */}
      {!quiet && (
        <div className="mt-4 space-y-3">
          {rows.map(({ meal, was, now, items }) => {
            const moved = Math.round(now) !== Math.round(was);
            const pct = was > 0 ? Math.round(((now - was) / was) * 100) : 0;
            return (
              <div key={meal.id} className="rounded-xl bg-[#0e1013] px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <p className="mr-auto min-w-0 truncate text-sm font-semibold">{meal.name}</p>
                  <p className="num shrink-0 text-xs text-[var(--color-mut)]">
                    {moved ? (
                      <>
                        {Math.round(was)} →{" "}
                        <b className="text-[var(--color-fg,#f2f4f7)]">{Math.round(now)}</b> kcal
                        <span className="ml-1.5" style={{ color: pct < 0 ? "var(--color-carbs)" : "var(--color-accent)" }}>
                          {pct > 0 ? "+" : ""}
                          {pct}%
                        </span>
                      </>
                    ) : (
                      <>{Math.round(now)} kcal · same</>
                    )}
                  </p>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {items.map((it, i) => {
                    const change = Math.round(it.to) !== Math.round(it.from);
                    return (
                      <li key={i} className="flex items-baseline gap-2 text-[0.8rem]">
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{ color: change ? "var(--color-fg, #f2f4f7)" : "var(--color-mut)" }}
                        >
                          {it.name}
                        </span>
                        <span className="num shrink-0">
                          {change ? (
                            <>
                              <span className="text-[var(--color-mut)]">{g(it.from)} → </span>
                              <b style={{ color: "var(--color-accent)" }}>{g(it.to)} g</b>
                            </>
                          ) : (
                            <span className="text-[var(--color-mut)]">{g(it.to)} g</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {review && review.held.length > 0 && !quiet && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
          Left as they are: {review.held.join(", ")} — the fit wanted to move{" "}
          {review.held.length === 1 ? "it" : "them"} by more than half in one go, which is a
          sign something upstream is off rather than a change worth making.
        </p>
      )}

      {/* The limits that stop it landing, and the one-tap way past each. */}
      {review && review.limits.length > 0 && !quiet && review.landsKcal != null &&
        Math.abs(review.landsKcal - review.to.kcal) > 30 && (
          <div className="mt-3 space-y-2">
            {review.limits.map((l, i) => (
              <div key={i} className="flag" style={{ ["--flag" as string]: "var(--color-carbs)" }}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold" style={{ color: "var(--color-carbs)" }}>
                    {l.name} ({l.meal}) is held at {l.from} g
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-mut)]">
                    Allowing {l.to} g closes {l.closes}
                    {l.key === "kcal" ? " kcal" : ` g of ${l.key}`}
                    {l.dayName ? ` on ${l.dayName} days` : ""}.
                  </p>
                </div>
                <button className="btn btn-sm shrink-0" disabled={busy} onClick={() => onLoosen(l)}>
                  Allow {l.to} g
                </button>
              </div>
            ))}
          </div>
        )}

      {review && (
        <Note label="Why">
          {review.detail}
          {review.weight.kgPerWeek != null &&
            ` Weight trend ${review.weight.kgPerWeek > 0 ? "+" : ""}${review.weight.kgPerWeek.toFixed(2)} ± ${review.weight.seKgPerWeek?.toFixed(2)} kg a week (aim ${review.weight.aimKg[0].toFixed(2)} to +${review.weight.aimKg[1].toFixed(2)}).`}
          {review.bf.settled && review.bf.ptsPerMonth != null
            ? ` Body fat ${review.bf.ptsPerMonth > 0 ? "+" : ""}${review.bf.ptsPerMonth.toFixed(1)} ± ${review.bf.sePtsPerMonth?.toFixed(1)} points a month (aim ${review.bf.aim[0]} to ${review.bf.aim[1]}).`
            : " Body fat isn't steering yet — it needs about two and a half weeks of scans."}{" "}
          Decided {day(review.on, { weekday: "long", day: "numeric", month: "short" })}.
        </Note>
      )}

      {!quiet && (
        <button className="btn mt-4 w-full" disabled={busy} onClick={onDiscard}>
          Keep this week&rsquo;s plan instead
        </button>
      )}
    </section>
  );
}
