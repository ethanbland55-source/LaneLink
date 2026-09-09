"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Stat } from "../macro-ui";
import { TrendChart } from "../trend-chart";
import { NumberField } from "../number-field";
import {
  buildWeekPlan,
  dayKey,
  normaliseDayType,
  type DayType,
  type Profile,
} from "@/lib/nutrition";
import { DOW_LABELS, normaliseProfile } from "@/lib/profile";
import { BF_MAX, BF_MIN, SCAN_ERROR, fromScan } from "@/lib/bodyfat";
import { applyRoll, rollDelta, rollState } from "@/lib/weekly";
import { steerRecomp } from "@/lib/steer";
import { Note } from "../explain";
import { Flag } from "../flag";
import {
  DEFAULT_RISE_PER_HOUR,
  SCAN_MIN_POINTS,
  calibrate,
  composition,
  hoursAwake,
  isScan,
  learnOffsets,
  parseClock,
  recompVerdict,
  riseAt,
  trendLine,
  weightRate,
  type IntakeDay,
  type WeighIn,
} from "@/lib/trend";

/**
 * Two measurements, and everything is built out of them.
 *
 * Bodyweight every day, at any time, corrected for the hour you took it. Body
 * fat twice a week off an eight-electrode scan, on the two days the plan
 * already turns on. There used to be a tape measure, a set of calipers and a
 * waist chart on this page as well; they are gone, and what replaced them is
 * not more measurement but less — one number that is actually measured rather
 * than three that were estimated from each other.
 *
 * The page reads top to bottom as one argument: here is what your weight is
 * doing, here is what you are made of, here is whether that combination is the
 * recomposition working, and here is the small thing the plan will do about it
 * on Monday.
 */
export default function ProgressPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dayTypes, setDayTypes] = useState<DayType[]>([]);
  const [entries, setEntries] = useState<WeighIn[]>([]);
  const [intake, setIntake] = useState<IntakeDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const today = dayKey();
  const [weight, setWeight] = useState("");
  const [atTime, setAtTime] = useState("");
  const [bf, setBf] = useState("");

  const load = useCallback(async () => {
    const [p, dt, w, i] = await Promise.all([
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/day-types").then((r) => r.json()),
      fetch("/api/weigh-ins?days=180").then((r) => r.json()),
      fetch("/api/intake?days=120").then((r) => r.json()),
    ]);
    setProfile(normaliseProfile(p));
    setDayTypes((dt as any[]).map((x, n) => normaliseDayType(x, n)));
    setEntries(w);
    setIntake(i);
    // Reload today's entry into the form so a second save edits rather than
    // silently wipes what was taken earlier.
    const mine = (w as any[]).find((e) => e.day === dayKey());
    setWeight(mine?.weight_kg != null ? String(mine.weight_kg) : "");
    setAtTime(mine?.at_time ?? "");
    setBf(mine?.bf_pct != null ? String(mine.bf_pct) : "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const plan = useMemo(
    () => (profile ? buildWeekPlan(profile, dayTypes) : null),
    [profile, dayTypes]
  );

  const line = useMemo(
    () => trendLine(entries).map((p) => ({ day: p.day, value: p.weight, trend: p.trend })),
    [entries]
  );
  const rate = useMemo(() => weightRate(entries), [entries]);
  const comp = useMemo(() => composition(entries), [entries]);
  const verdict = useMemo(() => recompVerdict(rate, comp), [rate, comp]);

  const steer = useMemo(
    () => (profile && plan ? steerRecomp(profile, rate, comp, plan.maintenance) : null),
    [profile, plan, rate, comp]
  );

  const cal = useMemo(
    () => (plan ? calibrate(entries, intake, plan.maintenance) : null),
    [entries, intake, plan]
  );

  const offsets = useMemo(() => learnOffsets(entries), [entries]);

  /**
   * What the scan in the form would mean, live, as you type.
   *
   * Against the *trend* weight, which is the same basis `composition` uses —
   * not the number on the scale this morning. That is not a detail: the two
   * differ by most of a kilo on any given day, and showing one figure above
   * the Save button and a different one for the same scan in the panel below
   * it would read as a bug. Today's reading is the fallback for a first scan
   * logged before there is enough weighing history to have a trend at all.
   */
  const liveScan = useMemo(() => {
    const kg = rate?.current ?? (Number(weight) > 20 ? Number(weight) : profile?.weight_kg ?? 0);
    return fromScan(Number(bf), kg);
  }, [bf, weight, rate, profile]);

  /**
   * Body fat, one point per scan, with a gentle line through it.
   *
   * Half a dozen readings a month is far too few for the exponential average
   * the weight chart uses, so this smooths at 0.5 — enough to stop one
   * dehydrated Saturday putting a kink in the line, not so much that the line
   * stops being the readings.
   */
  const bfPoints = useMemo(() => {
    if (!comp) return [];
    let t = comp.points[0]?.bfPct ?? 0;
    return comp.points.map((p) => {
      t = t + 0.5 * (p.bfPct - t);
      return { day: p.day, value: p.bfPct, trend: t };
    });
  }, [comp]);

  const leanPoints = useMemo(() => {
    if (!comp) return [];
    let t = comp.points[0]?.leanKg ?? 0;
    return comp.points.map((p) => {
      t = t + 0.5 * (p.leanKg - t);
      return { day: p.day, value: p.leanKg, trend: t };
    });
  }, [comp]);

  const roll = useMemo(
    () => (profile ? rollState(profile, entries, today) : null),
    [profile, entries, today]
  );
  const rollMove = useMemo(
    () => (profile && roll?.figures ? rollDelta(profile, roll.figures) : { kg: 0, bf: null }),
    [profile, roll]
  );

  /**
   * The two days to scan on are the two days the plan already turns on: the
   * day it rolls, and the day you shop. Nothing new to remember, and it means
   * the figure Monday's targets are built from was measured that morning
   * rather than at some point in the previous week.
   */
  const scanDows = useMemo(() => {
    if (!profile) return [] as number[];
    const roll = profile.plan_roll_dow;
    const shop = profile.shop_start_dow;
    return roll === shop ? [roll] : [roll, shop];
  }, [profile]);

  const todayDow = new Date(today + "T12:00:00").getDay();
  const scanToday = scanDows.includes(todayDow);
  const scannedToday = entries.some((e) => e.day === today && e.bf_pct != null);
  const lastScan = comp?.current ?? null;

  /** The soonest scan day still ahead, named. */
  const nextScanLabel = useMemo(() => {
    if (!scanDows.length) return "";
    const ahead = scanDows
      .map((d) => ({ d, days: (d - todayDow + 7) % 7 || 7 }))
      .sort((a, b) => a.days - b.days)[0];
    return ahead.days === 1 ? `tomorrow, ${DOW_LABELS[ahead.d]}` : DOW_LABELS[ahead.d];
  }, [scanDows, todayDow]);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  }

  /**
   * Each card writes only what it owns.
   *
   * They land in the same database row — lean mass is weight times body fat,
   * so the two have to describe the same morning — but they are saved from two
   * places on two rhythms, and a full-row write from either would blank the
   * other. Sending only the keys this card is responsible for means Monday's
   * scan cannot erase the weight typed at breakfast, and Tuesday's weight
   * cannot erase a scan that will not be retaken until Saturday. The API
   * leaves absent keys alone and treats an explicit null as "clear this".
   */
  async function put(body: Record<string, unknown>, msg: string) {
    await fetch("/api/weigh-ins", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day: today, ...body }),
    });
    await load();
    say(msg);
  }

  async function saveWeight() {
    await put(
      { weight_kg: weight ? Number(weight) : null, at_time: atTime || null },
      weight ? `Logged ${weight} kg` : "Weight cleared"
    );
  }

  async function saveScan() {
    await put(
      { bf_pct: bf ? Number(bf) : null },
      liveScan ? `Logged — ${liveScan.pct}% body fat` : "Scan cleared"
    );
  }

  /**
   * Rebuild this week's targets from the trend.
   *
   * Stamped with the roll day it is *for*, not today, so pressing it on a
   * Tuesday still counts as this week's roll and it won't ask again until the
   * next one comes round. The steer rides along: the snapshot and the calorie
   * step are one decision taken at one moment, never two that can disagree.
   */
  async function doRoll() {
    if (!profile || !roll?.figures) return;
    const next = applyRoll(profile, roll.figures, roll.dueOn, steer ?? undefined);
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    say(
      steer?.moving
        ? `Rebuilt on ${next.plan_weight_kg} kg, ${steer.kcal > 0 ? "+" : ""}${steer.kcal} kcal`
        : `Plan rebuilt on ${next.plan_weight_kg} kg`
    );
  }

  async function patch(change: Partial<Profile>, msg: string) {
    if (!profile) return;
    const next: Profile = { ...profile, ...change };
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    say(msg);
  }

  if (loading || !profile || !plan || !roll) {
    return <p className="py-24 text-center text-sm text-[var(--color-mut)]">Loading…</p>;
  }

  const phase = plan.phase;
  const tone =
    verdict.tone === "good"
      ? "var(--color-accent)"
      : verdict.tone === "watch"
        ? "var(--color-carbs)"
        : "var(--color-mut)";

  return (
    <div className="space-y-3">
      {flash && (
        <div className="num fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm text-[#10160a] shadow-2xl">
          {flash}
        </div>
      )}

      {/* Where you are */}
      <section className="card px-5 py-6">
        <div className="flex items-start">
          <div className="mr-auto">
            <p className="label">Trend weight</p>
            <p className="num-hero mt-2 text-[3.5rem] sm:text-[4rem]">
              {rate ? rate.current.toFixed(1) : "—"}
              <span className="ml-1 text-lg font-semibold text-[var(--color-mut)]">kg</span>
            </p>
          </div>
          {rate && (
            <div className="pt-1 text-right">
              <p className="label">Per week</p>
              <p
                className="num mt-2 text-2xl"
                style={{
                  color:
                    Math.abs(rate.pctPerWeek) < 0.25
                      ? "var(--color-mut)"
                      : rate.kgPerWeek < 0
                        ? "var(--color-accent)"
                        : "var(--color-carbs)",
                }}
              >
                {rate.kgPerWeek >= 0 ? "+" : ""}
                {rate.kgPerWeek.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-mut)]">
                {rate.pctPerWeek >= 0 ? "+" : ""}
                {rate.pctPerWeek.toFixed(2)}% · {rate.days}d
              </p>
            </div>
          )}
        </div>

        <div className="mt-5">
          <TrendChart points={line} color="var(--color-accent)" unit="kg" decimals={1} />
        </div>
        <p className="mt-1 text-[0.68rem] text-[#5b6270]">
          Line is the smoothed trend; grey dots are what the scale actually said.
        </p>

        <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "#0e1013" }}>
          <p className="text-sm font-semibold" style={{ color: tone }}>
            {verdict.headline}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">{verdict.detail}</p>
        </div>
      </section>

      {/* Weigh in — every day, whenever.
          Its own card, and deliberately so. Weight and body fat used to sit in
          one row of boxes because they land in one database row, which is a
          reason about storage and not a reason about people. They are two
          different habits: one is daily and can be any hour because the
          reading is corrected for the hour; the other is twice a week, first
          thing, and is worthless if the conditions drift. Putting them side by
          side made the second look optional-daily rather than fixed-twice-a-
          week, and made an empty box on a Tuesday look like a missed task. */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Weigh in</p>
          <p className="text-xs text-[var(--color-mut)]">{prettyDay(today)}</p>
        </div>
        <p className="mt-1 text-xs text-[var(--color-mut)]">Every day, any time.</p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Measure label="Weight" unit="kg" value={weight} onChange={setWeight} />
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--color-mut)]">What time</span>
            <div className="flex gap-2">
              <input
                type="time"
                className="field min-w-0 flex-1"
                aria-label="Time you weighed in"
                value={atTime}
                onChange={(e) => setAtTime(e.target.value)}
              />
              <button className="btn btn-sm shrink-0" onClick={() => setAtTime(nowClock())}>
                Now
              </button>
            </div>
          </label>
        </div>

        <p className="mt-2 text-xs text-[var(--color-mut)]">
          {atTime ? riseNote(atTime, offsets.risePerHour) : "so it can be corrected"}
        </p>

        <button className="btn btn-accent mt-4 w-full" onClick={saveWeight}>
          Save weight
        </button>

        <Note label="Weighed at an odd time?">
          You don&rsquo;t have to weigh at the same time every day — say when you did and the
          reading is corrected to what it would have been first thing before it touches the trend.
          You gain about a kilo through the day and none of it is fat.
        </Note>

        {offsets.measured ? (
          <p className="mt-2 text-xs leading-relaxed text-[#5b6270]">
            Measured on you: about <b>{(offsets.risePerHour * 1000).toFixed(0)} g an hour</b> awake
            {offsets.timed > 0 &&
              `, from ${offsets.timed} timed reading${offsets.timed === 1 ? "" : "s"}`}
            . That&rsquo;s taken off before the trend sees them.
          </p>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-[#5b6270]">
            Using a typical correction of {(DEFAULT_RISE_PER_HOUR * 1000).toFixed(0)} g an hour for
            now. Log a few at different times and it switches to one measured on you.
          </p>
        )}
      </section>

      {/* Body composition — the scan, and everything it produces.
          The input sits with its own results rather than up in the weigh-in,
          because what you type here is a different measurement on a different
          schedule, and because seeing the lean and fat figures move as you type
          is the fastest way to know you typed the right number. */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Body composition</p>
          {lastScan && <p className="text-xs text-[var(--color-mut)]">{prettyDay(lastScan.day)}</p>}
        </div>
        <p className="mt-1 text-xs text-[var(--color-mut)]">
          {scanDows.map((d) => DOW_LABELS[d]).join(" and ")} mornings, before you eat.
        </p>

        {/* Scan day gets the attention colour. It is a prompt rather than a
            problem, but it is the one thing on this page that cannot be done
            later — once the morning has gone, the conditions have gone. */}
        <Flag
          className="mt-3"
          tone={scanToday && !scannedToday ? "warn" : "info"}
          title={
            scannedToday
              ? "Scanned today"
              : scanToday
                ? "Scan day — before food or drink"
                : `Next scan ${nextScanLabel}`
          }
          detail={
            scannedToday
              ? "Logged. Nothing else to do until the next one."
              : scanToday
                ? "First thing, after the loo, nothing drunk yet. Same conditions every time or the numbers aren't comparable."
                : "Weight on its own is plenty in between."
          }
        />

        <div className="mt-4 flex items-end gap-3">
          <label className="block w-32">
            <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Body fat (%)</span>
            <NumberField
              step={0.1}
              className="w-full"
              allowEmpty
              placeholder={scanToday ? "scan day" : "if scanned"}
              aria-label="Body fat percent from the scan"
              value={bf === "" ? null : Number(bf)}
              onCommit={(v) => setBf(v == null ? "" : String(v))}
            />
          </label>
          <button className="btn btn-accent flex-1" onClick={saveScan}>
            {liveScan ? `Save ${liveScan.pct}%` : "Save scan"}
          </button>
        </div>

        {bf !== "" && !liveScan ? (
          <Flag
            className="mt-3"
            tone="bad"
            title="That figure won't save"
            detail={`Body fat has to be between ${BF_MIN} and ${BF_MAX}%.`}
          />
        ) : (
          liveScan && (
            <p className="mt-2 text-xs text-[var(--color-mut)]">
              {liveScan.pct}% of your {(liveScan.leanKg + liveScan.fatKg).toFixed(1)} kg trend
              weight is <b className="text-[#f2f4f7]">{liveScan.leanKg} kg lean</b> and{" "}
              {liveScan.fatKg} kg fat.
            </p>
          )
        )}

        <Note label="Which number off the scale?">
          The whole-body one — the single percentage for all of you. Your scale also breaks fat and
          muscle down per arm, per leg and trunk, and those are worth a look but not worth typing:
          the segments are the least repeatable part of a bioimpedance reading, and every target in
          this app is built from the one total. Lean and fat mass in kilograms don&rsquo;t need
          entering either. This works those out from the percentage and your trend weight, so they
          can never end up describing a different morning from the one you weighed on.
        </Note>

        {lastScan && comp ? (
          <div className="mt-4 border-t border-[#1c1f25] pt-4">
            <div className="flex items-start">
              <div className="mr-auto">
                <p className="label">Body fat</p>
                <p className="num-hero mt-1 text-[3rem]">
                  {lastScan.bfPct}
                  <span className="ml-1 text-lg font-semibold text-[var(--color-mut)]">%</span>
                </p>
              </div>
              {comp.settled && (
                <div className="pt-1 text-right">
                  <p className="label">Per month</p>
                  <p
                    className="num mt-2 text-2xl"
                    style={{
                      color:
                        comp.bfPtsPerMonth < -0.1
                          ? "var(--color-accent)"
                          : comp.bfPtsPerMonth > 0.1
                            ? "var(--color-carbs)"
                            : "var(--color-mut)",
                    }}
                  >
                    {comp.bfPtsPerMonth >= 0 ? "+" : ""}
                    {comp.bfPtsPerMonth.toFixed(1)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-mut)]">
                    {comp.scans} scans · {comp.days}d
                  </p>
                </div>
              )}
            </div>

            {bfPoints.length >= 2 && (
              <div className="mt-4">
                <TrendChart points={bfPoints} color="var(--color-carbs)" unit="%" decimals={1} />
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat
                label="Lean"
                value={`${lastScan.leanKg} kg`}
                accent
                sub={
                  comp.settled
                    ? `${comp.leanKgPerMonth >= 0 ? "+" : ""}${comp.leanKgPerMonth.toFixed(1)} kg a month`
                    : undefined
                }
              />
              <Stat
                label="Fat"
                value={`${lastScan.fatKg} kg`}
                sub={
                  comp.settled
                    ? `${comp.fatKgPerMonth >= 0 ? "+" : ""}${comp.fatKgPerMonth.toFixed(1)} kg a month`
                    : undefined
                }
              />
            </div>

            {leanPoints.length >= 2 && comp.settled && (
              <div className="mt-4">
                <p className="label mb-2">Lean mass</p>
                <TrendChart points={leanPoints} color="var(--color-accent)" unit="kg" decimals={1} />
              </div>
            )}

            {!comp.settled && (
              <Flag
                className="mt-3"
                tone="info"
                title={`${comp.scans} of ${SCAN_MIN_POINTS} scans`}
                detail="Twice a week for three weeks, then this reports a direction rather than a number."
              />
            )}

            <Note label="How much to trust this">
              The percentage is worth about ±{SCAN_ERROR} points against a lab method, and most of
              that is a fixed offset for your body and your scale — so the number is approximate
              and the way it moves is real. Lean mass here is your trend weight times what the scan
              said, not the figure on the display: bioimpedance reads how hydrated you are, and
              using the smoothed weight keeps a salty Friday out of Saturday&rsquo;s answer.
            </Note>
          </div>
        ) : (
          <div className="mt-4 border-t border-[#1c1f25] pt-4">
            <p className="text-sm leading-relaxed text-[var(--color-mut)]">
              Nothing scanned yet. Stand on the scale holding the handle, first thing on{" "}
              {scanDows.map((d) => DOW_LABELS[d]).join(" or ")}, and put the overall percentage in
              the box above.
            </p>
            <Note label="Why this and not a tape measure">
              A tape has no way to tell a smaller waist from a bigger back, and against DXA its
              agreement gets <i>worse</i> over a training block — which is exactly the window that
              matters here. Calipers need a repeatability nobody has on themselves. Eight
              electrodes put current through your arms and trunk as well as your legs, which is
              what makes the difference between two scans mean something.
            </Note>
          </div>
        )}
      </section>

      {/* What this week's plan is built on, and what it's about to do */}
      <section className="card px-5 py-5">
        <p className="label">This week&rsquo;s plan</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="num-hero text-[2.5rem]">{roll.current.weightKg.toFixed(1)}</p>
          <p className="text-sm text-[var(--color-mut)]">
            kg
            {roll.current.bodyFatPct != null && ` · ${roll.current.bodyFatPct}% body fat`}
          </p>
        </div>

        <Note label="Where this figure comes from">
          {roll.current.fromSnapshot
            ? `Taken from your trend on ${prettyDay(roll.lastRolled ?? roll.dueOn)}. Every target, the shopping list and the cook list are built on this figure, and it holds still until ${prettyDay(roll.nextOn)} — so what you buy on shopping day is what you eat all week.`
            : `Your typed-in weight, until there are enough weigh-ins for a trend. From then on this updates itself every ${DOW_LABELS[profile.plan_roll_dow]}.`}
        </Note>

        {roll.due && roll.figures ? (
          <Flag
            className="mt-4"
            title="This week's targets are out of date"
            detail={
              `Roll day was ${prettyDay(roll.dueOn)}. You're now ` +
              `${roll.figures.weightKg.toFixed(1)} kg` +
              `${rollMove.kg !== 0 ? ` (${rollMove.kg > 0 ? "+" : ""}${rollMove.kg} kg)` : ""}` +
              `${roll.figures.bodyFatPct != null ? ` at ${roll.figures.bodyFatPct}% body fat` : ""}.`
            }
            action={
              <button className="btn btn-sm btn-accent" onClick={doRoll}>
                Rebuild them
              </button>
            }
          />
        ) : (
          <p className="mt-3 text-xs text-[#5b6270]">
            Next update {prettyDay(roll.nextOn)}.
            {roll.figures &&
              ` Your trend is ${roll.figures.weightKg.toFixed(1)} kg right now, from ${roll.figures.readings} weigh-ins.`}
          </p>
        )}

        <label className="mt-4 flex items-center gap-2.5">
          <button
            className="tick"
            data-on={profile.auto_roll}
            aria-pressed={profile.auto_roll}
            onClick={() => patch({ auto_roll: !profile.auto_roll }, profile.auto_roll ? "You'll rebuild it yourself" : "Will rebuild on roll day")}
          >
            {profile.auto_roll ? "✓" : ""}
          </button>
          <span className="text-sm">Rebuild it for me on {DOW_LABELS[profile.plan_roll_dow]}</span>
        </label>
      </section>

      {/* Keeping you on track */}
      {steer && (
        <section className="card px-5 py-5">
          <div className="flex items-baseline">
            <p className="label mr-auto">Keeping you on track</p>
            {profile.recomp_adjust !== 0 && (
              <span className="num text-sm text-[var(--color-mut)]">
                {steer.totalKcal > 0 ? "+" : ""}
                {steer.totalKcal} kcal
              </span>
            )}
          </div>

          <p
            className="mt-3 text-sm font-semibold"
            style={{
              color:
                steer.tone === "good"
                  ? "var(--color-accent)"
                  : steer.tone === "watch"
                    ? "var(--color-carbs)"
                    : "var(--color-fg)",
            }}
          >
            {steer.headline}
            {steer.moving && (
              <span className="num ml-2 text-[var(--color-mut)]">
                {steer.kcal > 0 ? "+" : ""}
                {steer.kcal} kcal on {DOW_LABELS[profile.plan_roll_dow]}
              </span>
            )}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">{steer.detail}</p>

          <Note label="How the adjusting works">
            Your scans say whether fat is coming off and muscle is staying on. If they do, nothing
            changes. If they don&rsquo;t, the seven-day calorie average moves by about 1.5% — 45
            kcal or so — once a week, on {DOW_LABELS[profile.plan_roll_dow]}, at the same moment
            the plan rebuilds and the portions are re-fitted. It never accounts for more than 8%
            either way: past that, something you typed in is wrong and hiding it under a bigger
            correction would only make it harder to find.
          </Note>

          {/* Maintenance itself, measured. The steer sets the offset from
              maintenance; this sets maintenance. Kept together because
              otherwise they read like two rival opinions about calories. */}
          <details className="mt-3 border-t border-[#1c1f25] pt-3">
            <summary className="cursor-pointer text-xs text-[var(--color-mut)]">
              What your maintenance actually is
            </summary>
            {cal ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Stat label="Formula" value={plan.maintenance} sub="BMR + sessions" />
                  <Stat
                    label="Your data"
                    value={cal.tdee}
                    accent
                    sub={`${cal.confidence} confidence`}
                  />
                  <Stat
                    label="Difference"
                    value={`${cal.tdee - plan.maintenance >= 0 ? "+" : ""}${cal.tdee - plan.maintenance}`}
                    sub={`${Math.round((cal.factor - 1) * 100)}%`}
                  />
                </div>

                <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
                  Over {cal.days} days you ate {cal.intake.toLocaleString()} kcal a day across{" "}
                  {cal.intakeDays} logged days and the trend moved{" "}
                  {cal.kgPerWeek >= 0 ? "+" : ""}
                  {cal.kgPerWeek.toFixed(2)} kg a week. What you ate minus what you stored is what
                  you burned.
                </p>

                {cal.confidence === "low" && (
                  <Flag
                    className="mt-2"
                    title="Thin data so far"
                    detail="More logged days before it's worth acting on."
                  />
                )}

                <button
                  className={`mt-3 w-full ${profile.use_calibration ? "btn" : "btn btn-accent"}`}
                  onClick={() =>
                    patch(
                      {
                        calibrated_tdee: profile.use_calibration ? profile.calibrated_tdee : cal.tdee,
                        use_calibration: !profile.use_calibration,
                      },
                      profile.use_calibration ? "Back to the formula" : "Using your own numbers"
                    )
                  }
                >
                  {profile.use_calibration
                    ? "Stop using it, go back to the formula"
                    : "Use this instead of the formula"}
                </button>
              </>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
                Needs about two weeks of daily weigh-ins and confirmed food logs in the same
                window. Then this works out what you actually burn from what you actually ate.
              </p>
            )}
          </details>
        </section>
      )}

      {/* Phase */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">{phase.name || "Phase"}</p>
          {phase.week != null && (
            <span className="text-xs text-[var(--color-mut)]">
              week {phase.week} of {phase.weeks}
            </span>
          )}
        </div>

        {phase.progress != null ? (
          <>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#23262c]">
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-700"
                style={{ width: `${Math.round(phase.progress * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
              Started at {pct(phase.startAdjust)} and ends at {pct(phase.endAdjust)} of
              maintenance. Today you&rsquo;re at <b className="text-[#f2f4f7]">{pct(phase.adjust)}</b>
              {profile.recomp_adjust !== 0 && (
                <>
                  {" "}
                  plus {pct(profile.recomp_adjust)} from your scans
                </>
              )}
              , which is {plan.goalKcal.toLocaleString()} kcal as a seven-day average.
              {phase.daysLeft != null && phase.daysLeft > 0 && ` ${phase.daysLeft} days to go.`}
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
            Open-ended at {pct(phase.adjust)} of maintenance —{" "}
            {plan.goalKcal.toLocaleString()} kcal as a seven-day average. Give the phase a start
            date and a length on the Plan page if you want the target to drift over the block.
          </p>
        )}
      </section>

      {/* The numbers, as numbers */}
      {entries.length > 0 && (
        <section className="card px-5 py-5">
          <p className="label mb-3">Recent readings</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="text-[var(--color-mut)]">
                  <th className="pb-2 pr-4 font-semibold">Day</th>
                  <th className="pb-2 pr-4 font-semibold">Weight</th>
                  <th className="pb-2 pr-4 font-semibold">Trend</th>
                  <th className="pb-2 pr-4 font-semibold">Body fat</th>
                  <th className="pb-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {[...entries]
                  .slice(-14)
                  .reverse()
                  .map((e) => {
                    const t = line.find((p) => p.day === e.day);
                    return (
                      <tr key={e.day} className="border-t border-[#1c1f25]">
                        <td className="py-1.5 pr-4">{e.day}</td>
                        <td className="py-1.5 pr-4">
                          {e.weight_kg != null ? Number(e.weight_kg).toFixed(1) : "—"}
                        </td>
                        <td className="py-1.5 pr-4 text-[var(--color-mut)]">
                          {t ? t.trend.toFixed(2) : "—"}
                        </td>
                        <td
                          className="py-1.5 pr-4"
                          style={
                            e.bf_pct != null && !isScan(e)
                              ? { color: "#5b6270" }
                              : undefined
                          }
                        >
                          {e.bf_pct != null
                            ? `${Number(e.bf_pct).toFixed(1)}%${isScan(e) ? "" : "*"}`
                            : "—"}
                        </td>
                        <td className="py-1.5 text-[var(--color-mut)]">
                          {e.at_time ??
                            (e.tag === "evening"
                              ? "evening"
                              : e.tag === "other"
                                ? "daytime"
                                : "morning")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {entries.some((e) => e.bf_pct != null && !isScan(e)) && (
            <p className="mt-2 text-[0.7rem] leading-relaxed text-[#5b6270]">
              * from the old tape estimate. Kept because it happened, left out of the chart and the
              slope because a tape and a scan have different offsets — a series that switches
              between them has a step in it that looks like progress and isn&rsquo;t.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function pct(v: number): string {
  const n = Math.round(v * 1000) / 10;
  if (Math.abs(n) < 0.05) return "maintenance";
  return `${n > 0 ? "+" : ""}${n}%`;
}

/** "Sat 30 Aug" — short enough for a sentence, clear enough to act on. */
function prettyDay(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** The clock right now, as the time input wants it. */
function nowClock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** What a reading at this time is being corrected by, in plain words. */
function riseNote(at: string, perHour: number): string {
  const h = parseClock(at);
  if (h == null) return "";
  const rise = riseAt(hoursAwake(h), perHour);
  if (rise < 0.05) return "first thing — nothing to correct";
  return `reads about ${rise.toFixed(1)} kg heavy at this hour, corrected out`;
}

/** One labelled number box. */
function Measure({
  label,
  unit,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-[var(--color-mut)]">
        {label} ({unit})
      </span>
      <NumberField
        step={step}
        className="w-full"
        allowEmpty
        value={value === "" ? null : Number(value)}
        onCommit={(v) => onChange(v == null ? "" : String(v))}
      />
    </label>
  );
}
