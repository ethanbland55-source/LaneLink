"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Stat } from "../macro-ui";
import { buildShoppingList, shopListText, type ShopLine } from "@/lib/shopping";
import { cookPlan, type BatchCook, type PlanMeal } from "@/lib/batch";
import {
  addDays,
  buildWeekPlan,
  dayKey,
  dayTypeIdFor,
  normaliseDayType,
  type DayType,
  type Profile,
} from "@/lib/nutrition";
import { planDayForShop, stagedProfile } from "@/lib/weekly";
import { overlayPending, type PendingPortion } from "@/lib/pending";
import { normaliseProfile, SHOP_DAY_OPTIONS } from "@/lib/profile";
import { NumberField, scrollIntoViewSoon } from "../number-field";
import type { Stock } from "@/lib/stock";
import { Note, SectionLabel } from "../explain";
import { Flag } from "../flag";

export default function ShopPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<PlanMeal[]>([]);
  /** What's in the cupboard now — the last count, less everything logged since. */
  const [stock, setStock] = useState<Stock[]>([]);
  const [dayTypes, setDayTypes] = useState<DayType[]>([]);
  /** Lines in the trolley, and how much of each went into the cupboard. */
  const [checked, setChecked] = useState<Map<string, number>>(new Map());
  const [days, setDays] = useState<number | null>(null);
  const [start, setStart] = useState(dayKey());
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Staged portions the list is buying for, so it can say that it is. */
  const [pending, setPending] = useState<PendingPortion[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [p, m, pan, ch, dt, pe] = await Promise.all([
          fetch("/api/profile").then((r) => r.json()),
          fetch("/api/meals").then((r) => r.json()),
          fetch("/api/pantry").then((r) => r.json()),
          fetch("/api/checks").then((r) => r.json()),
          fetch("/api/day-types").then((r) => r.json()),
          fetch("/api/pending")
            .then((r) => r.json())
            .catch(() => ({ portions: [] })),
        ]);
        const prof = normaliseProfile(p);
        setProfile(prof);

        /**
         * The shop buys the *staged* plan, not the live one.
         *
         * This is the whole reason staging exists. On Saturday the live plan
         * describes the containers you are still eating out of; the food you
         * are about to buy is for the week that starts on Monday, and Monday's
         * portions are the ones sitting in `pending_portions`. Overlaying them
         * here is what keeps the trolley and the plan in agreement — a week
         * apart, which is exactly right.
         */
        const staged: PendingPortion[] = pe.portions ?? [];
        setPending(staged);
        setMeals(
          staged.length
            ? (m as PlanMeal[]).map((meal) => ({
                ...meal,
                ingredients: overlayPending(meal.id, meal.ingredients as any[], staged),
              }))
            : m
        );
        setDayTypes((dt as any[]).map((x, i) => normaliseDayType(x, i)));
        setStock(pan);
        setChecked(new Map((ch as { key: string; bought: number }[]).map((c) => [c.key, c.bought])));
        setDays(prof.shop_days);
      } catch {
        setError("Can't reach the database.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * The shop buys for the week the food is *for*, not the week you're in.
   *
   * You shop on Saturday and start eating it on Monday, so a list built
   * against today's targets is built against a week that's nearly over. The
   * plan itself doesn't move until roll day — that's the point — but the
   * shopping list has to look across it.
   */
  const planDay = useMemo(
    () => (profile ? planDayForShop(profile.plan_roll_dow, start) : start),
    [profile, start]
  );

  // Next week's targets once the review has decided them — the list's
  // warnings should compare the food against the week it is for.
  const plan = useMemo(
    () => (profile ? buildWeekPlan(stagedProfile(profile), dayTypes, { today: planDay }) : null),
    [profile, dayTypes, planDay]
  );

  /**
   * The cupboard as it was before this shop.
   *
   * Ticking a line puts what you bought into the cupboard straight away, so
   * the stock figure goes up mid-shop. The list must not see that — otherwise
   * ticking the chicken would turn "buy 1 kg" into "buy nothing" under your
   * thumb. What this trip has bought is taken back off before the list reads
   * it, and the line keeps saying what it said when you walked in.
   */
  const haveBefore = useMemo(
    () =>
      stock.map((s) => ({ name: s.name, grams: Math.max(0, s.grams - (checked.get(s.key) ?? 0)) })),
    [stock, checked]
  );

  const list = useMemo(() => {
    if (!profile || !plan) return null;
    return buildShoppingList(meals, profile, plan, {
      days: days ?? profile.shop_days,
      startDay: start,
      pantry: haveBefore,
    });
  }, [meals, profile, plan, days, start, haveBefore]);

  /** What to cook once the shopping is done — same window, same day types. */
  const cook = useMemo(() => {
    if (!profile || !plan) return null;
    return cookPlan(meals, plan, {
      days: days ?? profile.shop_days,
      dayTypeForDay: (i) => dayTypeIdFor(plan, addDays(start, i)),
    });
  }, [meals, profile, plan, days, start]);

  const say = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  }, []);

  async function saveDays(n: number) {
    setDays(n);
    if (!profile) return;
    const next = { ...profile, shop_days: n };
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
  }

  async function reloadStock() {
    try {
      setStock(await fetch("/api/pantry").then((r) => r.json()));
    } catch {
      /* the list still works on the figures it has */
    }
  }

  /**
   * Tick a line into the trolley — and into the cupboard.
   *
   * `bought` defaults to what the list said to buy. Change it on the line
   * afterwards if the shop only had the big bag.
   */
  async function mark(line: ShopLine, on: boolean, bought = line.buyGrams) {
    setChecked((m) => {
      const n = new Map(m);
      if (on) n.set(line.key, bought);
      else n.delete(line.key);
      return n;
    });
    await fetch("/api/checks", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: line.key,
        checked: on,
        name: line.name,
        bought: on ? bought : 0,
        day: dayKey(),
      }),
    });
    await reloadStock();
  }

  async function clearChecks() {
    setChecked(new Map());
    await fetch("/api/checks", { method: "DELETE" });
    say("New shop started — what you bought is in the cupboard");
  }

  /** You looked, and this is what's there. Replaces the running figure. */
  async function setHave(name: string, grams: number) {
    await fetch("/api/pantry", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, grams, day: dayKey() }),
    });
    await reloadStock();
    say(grams > 0 ? `${name}: ${fmt(grams)} in the cupboard` : `${name} cleared`);
  }

  async function copy() {
    if (!list) return;
    try {
      await navigator.clipboard.writeText(shopListText(list));
      say("Copied");
    } catch {
      say("Couldn't copy");
    }
  }

  if (loading) {
    return <p className="py-24 text-center text-sm text-[var(--color-mut)]">Loading…</p>;
  }
  if (!profile || !list) {
    return (
      <p className="py-24 text-center text-sm text-[var(--color-fat)]">
        {error ?? "Something went wrong."}
      </p>
    );
  }

  const total = list.lines.length;
  const done = list.lines.filter((l) => checked.has(l.key)).length;
  const stockByKey = new Map(stock.map((x) => [x.key, x]));
  const shelf = stock.filter((x) => x.grams > 0 || x.counted > 0);

  return (
    <div className="space-y-3">
      {flash && (
        <div className="num fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm text-[#10160a] shadow-2xl">
          {flash}
        </div>
      )}

      {/* Window */}
      <section className="card px-5 py-5">
        <div className="flex items-start">
          <div className="mr-auto">
            <p className="label">Buying for</p>
            <p className="num mt-2 text-[3.25rem] sm:text-[3.75rem]">
              {list.days}
              <span className="ml-1 text-lg font-semibold text-[var(--color-mut)]">
                day{list.days === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <p className="pt-1 text-right text-xs leading-relaxed text-[var(--color-mut)]">
            {pretty(list.startDay)}
            <br />
            to {pretty(list.endDay)}
          </p>
        </div>

        {pending.length > 0 && (
          <div className="mt-3 rounded-lg bg-[var(--color-surface)] px-3 py-2.5">
            <p className="text-xs text-[var(--color-mut)]">
              Buying{" "}
              <b className="text-[var(--color-fg)]">
                {profile?.next_review ? "next week's" : "the rebalanced"}
              </b>{" "}
              portions — {pending.length} change{pending.length === 1 ? "" : "s"} for{" "}
              {pretty(pending[0].apply_on)}.
              {profile?.next_review && profile.next_review.moving && !profile.next_review.dismissed
                ? ` ${profile.next_review.headline}: ${profile.next_review.stepKcal > 0 ? "+" : "−"}${Math.abs(profile.next_review.stepKcal)} kcal a day.`
                : ""}{" "}
              <Link href="/plan" className="underline">
                See it on the Plan page
              </Link>
            </p>
            <Note label="Why next week's">The food you buy now is for next week.</Note>
          </div>
        )}

        <div className="no-print mt-4 flex flex-wrap gap-1.5">
          {SHOP_DAY_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => saveDays(n)}
              className={`${list.days === n ? "btn btn-accent" : "btn"} btn-sm`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* A bare number box next to the presets read as an eighth preset,
            especially once inputs went up to 16px on a phone. Labelling it is
            the whole fix. */}
        <label className="no-print mt-2 flex items-center gap-2">
          <span className="text-xs text-[var(--color-mut)]">or</span>
          <NumberField
            min={1}
            max={21}
            className="w-20 px-2 py-1 text-center text-sm"
            value={days}
            aria-label="Number of days to buy for"
            onCommit={(v) => v != null && saveDays(Math.min(21, Math.max(1, v)))}
          />
          <span className="text-xs text-[var(--color-mut)]">days</span>
        </label>

        <label className="no-print mt-3 block">
          <span className="label mb-1.5 block">Shop day</span>
          <input
            type="date"
            className="field w-full max-w-[13rem]"
            value={start}
            onChange={(e) => setStart(e.target.value || dayKey())}
          />
        </label>

        {profile.cycling && list.dayMix.length > 0 && (
          <p className="mt-3 text-xs text-[var(--color-mut)]">
            {list.dayMix.map((d) => `${d.count} × ${d.name.toLowerCase()}`).join(", ")}
          </p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Food" value={`${list.totalKg.toFixed(1)} kg`} sub={`${(list.totalKg / list.days).toFixed(1)} kg/day`} />
          <Stat label="Lines" value={total} sub={`${done} in the trolley`} />
          <Stat
            label="Protein"
            value={`${Math.round(list.perDay.protein)} g`}
            sub="per day"
            accent
          />
        </div>
      </section>

      {list.warnings.map((w, i) => (
        <Flag key={i} title={w.title} detail={w.detail}>
          {w.more && <Note label="Why">{w.more}</Note>}
        </Flag>
      ))}

      {total === 0 ? (
        <section className="card px-5 py-10 text-center">
          <p className="text-sm text-[var(--color-mut)]">
            Nothing to buy — your plan has no ingredients yet.
          </p>
          <Link href="/plan" className="btn btn-accent mt-4">
            Build your plan
          </Link>
        </section>
      ) : (
        <>
          <div className="no-print flex gap-2">
            <button className="btn flex-1" onClick={copy}>
              Copy list
            </button>
            <button className="btn flex-1" onClick={() => window.print()}>
              Print
            </button>
            <button className="btn flex-1" onClick={clearChecks}>
              New shop
            </button>
          </div>

          {list.byAisle.map((group) => (
            <section key={group.aisle} className="card px-4 py-4 sm:px-5">
              <div className="mb-3 flex items-baseline gap-2">
                <p className="label mr-auto">{group.aisle}</p>
                <span className="text-xs tabular-nums text-[var(--color-mut)]">
                  {group.kg.toFixed(1)} kg
                </span>
              </div>
              <div className="space-y-1.5">
                {group.lines.map((l) => (
                  <Line
                    key={l.key}
                    line={l}
                    checked={checked.has(l.key)}
                    bought={checked.get(l.key) ?? 0}
                    inCupboard={stockByKey.get(l.key)?.grams ?? 0}
                    onToggle={() => mark(l, !checked.has(l.key))}
                    onBought={(g) => mark(l, true, g)}
                    onHave={(g) => setHave(l.name, g)}
                  />
                ))}
              </div>
            </section>
          ))}

          {cook && cook.meals.length > 0 && (
            <section className="card px-4 py-4 sm:px-5">
              <SectionLabel
                title="Cook list"
                info="Cook each one, then split it evenly between the containers."
              />
              <p className="mt-1.5 text-xs text-[var(--color-mut)]">
                Totals for the whole window. Weigh, cook, divide.
              </p>

              <div className="mt-4 space-y-4">
                {cook.meals.map((m) => (
                  <CookCard key={m.mealId} cook={m} />
                ))}
              </div>

              {cook.notes.map((n, i) => (
                <p key={i} className="mt-3 text-xs leading-relaxed text-[#5b6270]">
                  {n}
                </p>
              ))}
            </section>
          )}

          {/* The cupboard. Runs itself down as meals are logged, so next
              week's list starts from what's actually left. Anything can be
              corrected by hand — food goes off, friends come round. */}
          {shelf.length > 0 && (
            <section className="card px-4 py-4 sm:px-5">
              <SectionLabel
                title="In the cupboard"
                info="What's left. It comes off next week's list."
              />
              {shelf.some((x) => !x.tracking) && (
                <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
                  &ldquo;Not tracking yet&rdquo; — check these once.
                  </p>
              )}
              <div className="mt-3 space-y-1.5">
                {shelf.map((x) => (
                  <Shelf key={x.key} item={x} onSet={(g) => setHave(x.name, g)} />
                ))}
              </div>
            </section>
          )}

          <div className="px-1 pb-4 text-center">
            <Note label="How these are worked out">Rounded up to packs, with the cupboard taken off first.</Note>
          </div>
        </>
      )}
    </div>
  );
}

function Line({
  line,
  checked,
  bought,
  inCupboard,
  onToggle,
  onBought,
  onHave,
}: {
  line: ShopLine;
  checked: boolean;
  /** What ticking this line put in the cupboard. */
  bought: number;
  /** The cupboard figure now, bought included. */
  inCupboard: number;
  onToggle: () => void;
  onBought: (grams: number) => void;
  onHave: (grams: number) => void;
}) {
  const [editing, setEditing] = useState<"have" | "bought" | null>(null);
  const [draft, setDraft] = useState("");

  const amount = line.unit
    ? `${line.unit.count} ${line.unit.name}${line.unit.count === 1 ? "" : "s"}`
    : line.buyGrams >= 1000
      ? `${(line.buyGrams / 1000).toFixed(line.buyGrams % 1000 === 0 ? 0 : 2)} kg`
      : `${Math.round(line.buyGrams)} g`;

  function open(which: "have" | "bought") {
    setDraft(String(Math.round(which === "have" ? inCupboard : bought) || ""));
    setEditing(which);
  }

  return (
    <div className={`sunk px-3 py-2.5 ${checked ? "done" : ""}`}>
      <div className="flex items-center gap-3">
        <button
          className="tick no-print"
          data-on={checked}
          onClick={onToggle}
          aria-label={checked ? `${line.name} in the trolley` : `Mark ${line.name} as picked up`}
        >
          {checked ? "✓" : ""}
        </button>

        <div className="mr-auto min-w-0">
          <p className="strike truncate text-sm font-semibold">{line.name}</p>
          <p className="mt-0.5 text-[0.7rem] text-[var(--color-mut)]">
            need {fmt(line.needGrams)}
            {line.haveGrams > 0 && ` · have ${fmt(line.haveGrams)}`}
            {line.packs > 1 && ` · ${line.packs} × ${fmt(line.packGrams)} packs`}
            {line.leftoverGrams > 20 && line.packs > 0 && ` · ${fmt(line.leftoverGrams)} spare`}
          </p>
        </div>

        <span className="num shrink-0 text-right text-sm" style={{ color: "var(--color-accent)" }}>
          {amount}
        </span>
      </div>

      {line.staple && (
        <p className="mt-1.5 pl-[2.6rem] text-[0.68rem] text-[#5b6270]">
          Cupboard staple — you only need {fmt(line.needGrams)}, so check before you buy another.
        </p>
      )}

      {line.trips > 1 && (
        <p className="no-print mt-1.5 pl-[2.6rem] text-[0.68rem]" style={{ color: "var(--color-carbs)" }}>
          Keeps about {line.shelfDays} days — buy {Math.ceil(line.shortGrams / line.trips / 10) * 10} g now
          and the rest later, or freeze it.
        </p>
      )}

      <div className="no-print mt-1.5 pl-[2.6rem]">
        {editing ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.68rem] text-[var(--color-mut)]">
              {editing === "bought" ? "Bought" : "In the cupboard now"}
            </span>
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              className="field w-24 px-2 py-1 text-right text-xs"
              value={draft}
              placeholder="grams"
              onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
              onChange={(e) => setDraft(e.target.value)}
            />
            <span className="text-[0.68rem] text-[var(--color-mut)]">g</span>
            <button
              className="btn btn-sm"
              onClick={() => {
                const g = Math.max(0, Number(draft) || 0);
                if (editing === "bought") onBought(g);
                else onHave(g);
                setEditing(null);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm btn-quiet" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </span>
        ) : checked ? (
          // Only when there's a figure to correct. A line ticked with nothing
          // to buy — or ticked before the cupboard tracked purchases — has
          // nothing to say here, and a prompt on every one of them was noise.
          bought > 0 && (
            <button
              className="hit text-[0.68rem] text-[#5b6270] underline decoration-dotted"
              onClick={() => open("bought")}
            >
              bought {fmt(bought)} — change
            </button>
          )
        ) : (
          <button
            className="hit text-[0.68rem] text-[#5b6270] underline decoration-dotted"
            onClick={() => open("have")}
          >
            {inCupboard > 0 ? `${fmt(inCupboard)} in the cupboard — change` : "I already have some"}
          </button>
        )}
      </div>
    </div>
  );
}

/** One cupboard shelf: what's left, where the figure came from, and a way to correct it. */
function Shelf({ item, onSet }: { item: Stock; onSet: (grams: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const since = item.counted_on ? pretty(item.counted_on) : null;
  const typed = item.counted_at ? pretty(item.counted_at.slice(0, 10)) : null;

  return (
    <div className="sunk px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="mr-auto min-w-0">
          <p className="truncate text-sm font-semibold">{item.name}</p>
          <p className="mt-0.5 text-[0.68rem] text-[#5b6270]">
            {item.tracking ? (
              <>
                {since ? `${fmt(item.counted)} on ${since}` : fmt(item.counted)}
                {item.used > 0 && ` · ${fmt(item.used)} eaten since`}
              </>
            ) : (
              `typed in${typed ? ` ${typed}` : ""} · not tracking yet`
            )}
          </p>
        </div>
        <span
          className="num shrink-0 text-sm"
          style={{ color: item.grams > 0 ? "var(--color-fg)" : "var(--color-mut)" }}
        >
          {item.grams > 0 ? fmt(item.grams) : "used up"}
        </span>
        {!editing && (
          <button
            className="btn btn-sm btn-quiet shrink-0"
            onClick={() => {
              setDraft(String(item.grams || ""));
              setEditing(true);
            }}
          >
            Change
          </button>
        )}
      </div>
      {editing && (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            className="field w-24 px-2 py-1 text-right text-xs"
            value={draft}
            placeholder="grams"
            onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
            onChange={(e) => setDraft(e.target.value)}
          />
          <span className="text-[0.68rem] text-[var(--color-mut)]">g left</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              onSet(Math.max(0, Number(draft) || 0));
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            className="btn btn-sm btn-quiet"
            onClick={() => {
              onSet(0);
              setEditing(false);
            }}
          >
            None left
          </button>
          <button className="btn btn-sm btn-quiet" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * One meal's prep: what to weigh out, and what it comes to once cooked.
 *
 * The raw column is what goes into the pan — dry pasta, raw chicken — because
 * that is what the plan is written in and what you actually weigh. The cooked
 * figure is what you will be dividing between containers afterwards, which is
 * the number you need at the other end of the evening.
 */
function CookCard({ cook }: { cook: BatchCook }) {
  const cooked = cook.ingredients.reduce((a, i) => a + i.cookedGrams, 0);

  return (
    <div className="sunk px-3.5 py-3">
      <div className="flex items-baseline gap-2">
        <p className="mr-auto text-sm font-semibold">{cook.name}</p>
        <span className="num text-sm" style={{ color: "var(--color-accent)" }}>
          {cook.servings} servings
        </span>
      </div>

      <div className="mt-2.5 space-y-1">
        {cook.ingredients
          .filter((i) => i.grams > 0)
          .map((i) => (
            <div key={i.name} className="flex items-center gap-3 text-xs">
              <span className="mr-auto min-w-0 flex-1 truncate">{i.name}</span>
              <span className="num w-16 text-right">{fmt(i.grams)}</span>
              {i.rawToCooked !== 1 && (
                <span className="w-24 text-right text-[0.68rem] text-[#5b6270]">
                  → {fmt(i.cookedGrams)} cooked
                </span>
              )}
            </div>
          ))}
      </div>

      {/* Cooked weight, not raw. Raw is what you weigh into the pan and it is
          in the list above; what goes on the scale afterwards, when you are
          splitting it between containers, is what it became. */}
      <p className="mt-2.5 border-t border-[#1c1f25] pt-2.5 text-[0.7rem] text-[var(--color-mut)]">
        Makes about {fmt(cooked)} once cooked — divide into {cook.servings}{" "}
        {cook.servings === 1 ? "portion" : "portions"} of roughly{" "}
        {Math.round(cooked / Math.max(1, cook.servings))} g.
      </p>

      {cook.fresh.length > 0 && (
        <p className="mt-1.5 text-[0.7rem] text-[#5b6270]">
          Add to each one on the day:{" "}
          {cook.fresh.map((f) => `${f.name.toLowerCase()} ${f.grams} g`).join(", ")}.
        </p>
      )}
    </div>
  );
}

function fmt(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g)} g`;
}

function pretty(d: string) {
  if (!d) return "";
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
