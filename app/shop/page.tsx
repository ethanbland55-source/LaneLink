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
import { planDayForShop } from "@/lib/weekly";
import { overlayPending, type PendingPortion } from "@/lib/pending";
import { normaliseProfile, SHOP_DAY_OPTIONS } from "@/lib/profile";
import { NumberField, scrollIntoViewSoon } from "../number-field";

type PantryRow = { name: string; grams: number };

export default function ShopPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [meals, setMeals] = useState<PlanMeal[]>([]);
  const [pantry, setPantry] = useState<PantryRow[]>([]);
  const [dayTypes, setDayTypes] = useState<DayType[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
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
        setPantry(pan);
        setChecked(new Set(ch));
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

  const plan = useMemo(
    () => (profile ? buildWeekPlan(profile, dayTypes, { today: planDay }) : null),
    [profile, dayTypes, planDay]
  );

  const list = useMemo(() => {
    if (!profile || !plan) return null;
    return buildShoppingList(meals, profile, plan, {
      days: days ?? profile.shop_days,
      startDay: start,
      pantry,
    });
  }, [meals, profile, plan, days, start, pantry]);

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

  async function toggle(key: string) {
    const on = !checked.has(key);
    setChecked((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
    await fetch("/api/checks", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, checked: on }),
    });
  }

  async function clearChecks() {
    setChecked(new Set());
    await fetch("/api/checks", { method: "DELETE" });
    say("New shop started");
  }

  async function setHave(name: string, grams: number) {
    setPantry((p) => {
      const rest = p.filter((x) => x.name !== name);
      return grams > 0 ? [...rest, { name, grams }] : rest;
    });
    await fetch("/api/pantry", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, grams }),
    });
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
          <p className="mt-3 rounded-lg bg-[var(--color-surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-mut)]">
            Buying the <b className="text-[var(--color-fg)]">rebalanced</b> portions —{" "}
            {pending.length} of them change on{" "}
            {pretty(pending[0].apply_on)}, which is the week this food is for. The Plan page still
            shows what&rsquo;s in the fridge until then.
          </p>
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
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
            This window is{" "}
            {list.dayMix.map((d) => `${d.count} × ${d.name.toLowerCase()}`).join(", ")}.
{" "}
            The list buys your plan exactly as written — the meals you've limited to certain day
            types are only counted on those days.
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
        <div key={i} className="rounded-xl bg-[#2a2416] px-4 py-3 text-xs leading-relaxed text-[#ffd08a]">
          {w}
        </div>
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
                    onToggle={() => toggle(l.key)}
                    onHave={(g) => setHave(l.name, g)}
                  />
                ))}
              </div>
            </section>
          ))}

          {cook && cook.meals.length > 0 && (
            <section className="card px-4 py-4 sm:px-5">
              <p className="label">Cook list</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">
                Everything you batch cook, for the whole window. Cook it once, then weigh the
                serving out on the day — the amounts below are already sized to each kind of day,
                so a heavier day gets a bigger plate rather than a different recipe.
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

          <p className="px-1 pb-4 text-center text-[0.7rem] leading-relaxed text-[#4a505c]">
            Amounts are rounded up to the nearest pack, and anything you already have is taken off
            first. Weights are as you'd weigh them for the plan — raw for meat, dry for rice and
            pasta.
          </p>
        </>
      )}
    </div>
  );
}

function Line({
  line,
  checked,
  onToggle,
  onHave,
}: {
  line: ShopLine;
  checked: boolean;
  onToggle: () => void;
  onHave: (grams: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [have, setHaveLocal] = useState(String(Math.round(line.haveGrams) || ""));

  const amount = line.unit
    ? `${line.unit.count} ${line.unit.name}${line.unit.count === 1 ? "" : "s"}`
    : line.buyGrams >= 1000
      ? `${(line.buyGrams / 1000).toFixed(line.buyGrams % 1000 === 0 ? 0 : 2)} kg`
      : `${Math.round(line.buyGrams)} g`;

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
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              autoFocus
              className="field w-24 px-2 py-1 text-right text-xs"
              value={have}
              placeholder="grams"
              onFocus={(e) => scrollIntoViewSoon(e.currentTarget)}
              onChange={(e) => setHaveLocal(e.target.value)}
            />
            <button
              className="btn btn-sm"
              onClick={() => {
                onHave(Number(have) || 0);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn btn-sm btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="text-[0.68rem] text-[#5b6270] underline decoration-dotted"
            onClick={() => setEditing(true)}
          >
            {line.haveGrams > 0 ? "change what I have in" : "I already have some"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One batch: what to cook, and how much of it to put on the plate on each kind
 * of day. The raw column is what you weigh into the pan; the cooked figure is
 * what you'll actually have afterwards, which is the one that has to fit in
 * your containers.
 */
function CookCard({ cook }: { cook: BatchCook }) {
  const cooked = cook.ingredients.reduce((a, i) => a + i.cookedGrams, 0);
  const spread = cook.byDayType.map((d) => d.grams);
  const varies = spread.length > 1 && Math.max(...spread) - Math.min(...spread) >= 25;

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

      <p className="mt-2.5 border-t border-[#1c1f25] pt-2.5 text-[0.7rem] text-[var(--color-mut)]">
        Makes about {fmt(cooked)} of food. Serve{" "}
        {varies ? (
          <>
            {cook.byDayType
              .map((d) => `${Math.round(d.grams)} g on ${d.name.toLowerCase()} days (×${d.count})`)
              .join(", ")}
            .
          </>
        ) : (
          <>{Math.round(cook.averageServing)} g a time.</>
        )}
      </p>
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
