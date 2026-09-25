"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendChart } from "../trend-chart";
import { NumberField } from "../number-field";
import {
  aimNow,
  buildWeekPlan,
  planWeight,
  dayKey,
  goalDef,
  normaliseDayType,
  type DayType,
  type Profile,
} from "@/lib/nutrition";
import { DOW_LABELS, normaliseProfile } from "@/lib/profile";
import { BF_MAX, BF_MIN, SCAN_ERROR, fromScan } from "@/lib/bodyfat";
import {
  EXTRA_METRICS,
  SCAN_METRICS,
  SEGMENTS,
  SEGMENT_FIELDS,
  SEGMENT_KEYS,
  bmi,
  segmentKey,
  segmentRatio,
  type ScanKey,
  type ScanMetric,
  type SegmentKey,
} from "@/lib/scan";
import { reviewDow, reviewSchedule, rollState } from "@/lib/weekly";
import { STEER_MIN_READINGS, bfNowOf, steerPlan, steerSignals, type Reading } from "@/lib/steer";
import { Note } from "../explain";
import { Flag } from "../flag";
import {
  SCAN_MIN_POINTS,
  composition,
  extraChange,
  hoursAwake,
  learnOffsets,
  parseClock,
  riseAt,
  trendLine,
  type WeighIn,
} from "@/lib/trend";

/** Every box on the scan card — the whole-body figures and the five segments. */
type ScanField = ScanKey | SegmentKey;
type ScanForm = Record<ScanField, string>;

const SCAN_FIELDS: ScanField[] = [...SCAN_METRICS.map((m) => m.key), ...SEGMENT_KEYS];

const EMPTY_SCAN = Object.fromEntries(SCAN_FIELDS.map((k) => [k, ""])) as ScanForm;

/**
 * Two measurements, and everything is built out of them.
 *
 * Bodyweight every day, at any time, corrected for the hour you took it. A scan
 * twice a week off an eight-electrode scale, on the two days the plan already
 * turns on. The page reads top to bottom in the order you use it: log today's
 * weight, log the scan if it's a scan day, then see whether the two together
 * are doing what your goal asks — and what Monday will do about it if not.
 */
export default function ProgressPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dayTypes, setDayTypes] = useState<DayType[]>([]);
  const [entries, setEntries] = useState<WeighIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const today = dayKey();
  const [weight, setWeight] = useState("");
  const [atTime, setAtTime] = useState("");
  const [scan, setScan] = useState<ScanForm>(EMPTY_SCAN);
  /** The body fat target being typed, before it's saved. */
  const [targetDraft, setTargetDraft] = useState<number | null | undefined>(undefined);
  const [dateDraft, setDateDraft] = useState<string | null | undefined>(undefined);
  /** The scan form open on a day that isn't asking for it. */
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const [p, dt, w] = await Promise.all([
      fetch("/api/profile").then((r) => r.json()),
      fetch("/api/day-types").then((r) => r.json()),
      fetch("/api/weigh-ins?days=180").then((r) => r.json()),
    ]);
    setProfile(normaliseProfile(p));
    setDayTypes((dt as any[]).map((x, n) => normaliseDayType(x, n)));
    setEntries(w);
    // Reload today's entry into both forms so a second save edits rather than
    // silently wipes what was taken earlier.
    const mine = (w as any[]).find((e) => e.day === dayKey());
    setWeight(mine?.weight_kg != null ? String(mine.weight_kg) : "");
    setAtTime(mine?.at_time ?? "");
    setScan(
      Object.fromEntries(
        SCAN_FIELDS.map((k) => [k, mine?.[k] != null ? String(mine[k]) : ""])
      ) as ScanForm
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const plan = useMemo(
    () => (profile ? buildWeekPlan(profile, dayTypes) : null),
    [profile, dayTypes]
  );

  const trend = useMemo(() => trendLine(entries), [entries]);
  const line = useMemo(
    () => trend.map((p) => ({ day: p.day, value: p.weight, trend: p.trend })),
    [trend]
  );
  // The readout shows twelve weeks of scans; the steer reads six weeks of them
  // and four of weight, with an error bar on each. See `steerSignals`.
  const comp = useMemo(() => composition(entries), [entries]);
  const signals = useMemo(() => steerSignals(entries), [entries]);
  const rate = signals.rate;

  const schedule = useMemo(
    () => (profile ? reviewSchedule(profile, dayKey()) : null),
    [profile]
  );

  /**
   * What the review would decide with today's data — or, once it has run, what
   * it did decide. The staged one wins: it is the decision the shopping list is
   * already buying for, and a preview that disagreed with it would be two
   * answers on one screen.
   */
  const steer = useMemo(
    () =>
      profile && plan
        ? steerPlan(profile, signals.rate, signals.comp, plan.maintenance, {
            applyOn: schedule?.rollOn,
          })
        : null,
    [profile, plan, signals, schedule]
  );
  const decided = profile?.next_review ?? null;

  const offsets = useMemo(() => learnOffsets(entries), [entries]);

  /**
   * The trend weight right now — what a scan typed today is split against.
   *
   * The trend, not this morning's number, which is the same basis the stored
   * scans use. The two differ by most of a kilo on any given day, and showing
   * one lean figure above the Save button and a different one for the same scan
   * once saved would read as a bug. Today's reading, then the profile, are the
   * fallbacks for an account with nothing weighed yet.
   */
  const trendNow =
    trend.length > 0
      ? trend[trend.length - 1].trend
      : Number(weight) > 20
        ? Number(weight)
        : (profile?.weight_kg ?? 0);

  const liveScan = useMemo(() => fromScan(Number(scan.bf_pct), trendNow), [scan.bf_pct, trendNow]);

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

  const roll = useMemo(
    () => (profile ? rollState(profile, entries, today) : null),
    [profile, entries, today]
  );
  /**
   * Scan on the day the plan comes in and on the day next week is decided —
   * Monday and Friday for a Saturday shop — so the freshest scan is the one
   * the review reads, rather than arriving the morning after it.
   */
  const scanDows = useMemo(() => {
    if (!profile) return [] as number[];
    const r = profile.plan_roll_dow;
    const s = reviewDow(profile);
    return r === s ? [r] : [r, s].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  }, [profile]);

  const todayDow = new Date(today + "T12:00:00").getDay();
  const scanToday = scanDows.includes(todayDow);
  const todays = entries.find((e) => e.day === today);
  const scannedToday = !!todays && todays.bf_pct != null;
  const weighedToday = !!todays && todays.weight_kg != null;
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
   * other. The API leaves absent keys alone and treats an explicit null as
   * "clear this".
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
    const body: Record<string, number | null> = {};
    for (const k of SCAN_FIELDS) body[k] = scan[k] ? Number(scan[k]) : null;
    await put(body, liveScan ? `Scan logged — ${liveScan.pct}% body fat` : "Scan cleared");
    setEditing(false);
  }

  /**
   * Work next week out now rather than waiting for review day.
   *
   * It stages for the coming roll day exactly as the automatic one does and
   * never touches the plan in force; review day re-runs it with that day's
   * weigh-ins.
   */
  const [reviewing, setReviewing] = useState(false);
  async function reviewNow() {
    setReviewing(true);
    const r = await fetch("/api/review", { method: "POST" }).then((x) => x.json());
    setReviewing(false);
    if (r?.error) return say(r.error);
    await load();
    say("Next week worked out — see the Plan page");
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

  if (loading || !profile || !plan || !roll || !steer) {
    return <p className="py-24 text-center text-sm text-[var(--color-mut)]">Loading…</p>;
  }

  // The aim in force — the hold-and-fuel one once the body fat target is reached.
  const aim = aimNow(profile, bfNowOf(signals.comp), steer.atTarget, schedule?.rollOn);
  const showForm = editing || (scanToday && !scannedToday);
  const scanDayWords = scanDows.map((d) => DOW_LABELS[d]).join(" and ");

  return (
    <div className="space-y-3">
      {flash && (
        <div className="num fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm text-[#10160a] shadow-2xl">
          {flash}
        </div>
      )}

      {/* Weigh in — every day, whenever.
          Its own card, and deliberately so. Weight and body fat land in one
          database row, which is a reason about storage and not a reason about
          people. They are two different habits: one is daily and can be any
          hour because the reading is corrected for the hour; the other is
          twice a week, first thing, and is worthless if the conditions drift. */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Weigh in</p>
          <p className="text-xs text-[var(--color-mut)]">{prettyDay(today)}</p>
        </div>
        <p className="mt-1 text-xs text-[var(--color-mut)]">Every day — first thing is best.</p>

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
          Log the time and it&rsquo;s corrected to a morning reading; evening ones count less.{" "}
          {offsets.measured
            ? `Your day adds about ${(offsets.risePerHour * 1000).toFixed(0)} g an hour.`
            : ""}
        </Note>
      </section>

      {/* Body composition — the scan, laid out the way the scale reports it.
          On a scan morning the card opens as a form, one box per figure the
          scale shows, in its order. Every other day it's the readout of the
          last scan, with how each figure has moved. */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Body composition</p>
          {lastScan && !showForm && (
            <p className="text-xs text-[var(--color-mut)]">{prettyDay(lastScan.day)}</p>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--color-mut)]">{scanDayWords} mornings, before you eat.</p>

        {/* One line, not a box. A prompt on a scan day, a quiet note otherwise. */}
        <p
          className="mt-3 flex items-center gap-2 text-xs font-semibold"
          style={{
            color: scannedToday
              ? "var(--color-accent)"
              : scanToday
                ? "var(--color-carbs)"
                : "var(--color-mut)",
          }}
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "currentColor" }}
          />
          {scannedToday
            ? "Scanned today"
            : scanToday
              ? "Scan day — first thing, after the loo, before food or drink"
              : `Next scan ${nextScanLabel}`}
        </p>

        {showForm ? (
          <ScanEntry
            scan={scan}
            onChange={(k, v) => setScan((s) => ({ ...s, [k]: v }))}
            live={liveScan}
            trendKg={trendNow}
            weighedToday={weighedToday}
            onSave={saveScan}
            onCancel={
              editing
                ? () => {
                    setEditing(false);
                    load();
                  }
                : undefined
            }
          />
        ) : lastScan && comp ? (
          <>
            <ScanReadout
              comp={comp}
              heightCm={profile.height_cm}
            />

            {lastScan.offHydration && (
              <Flag
                className="mt-3"
                title="That scan was taken drier or wetter than usual"
                detail="It's shown, but left out of the trend."
              >
                <Note label="Why">
                  Your water was off your usual that morning, so it&rsquo;s left out of the trend.
                  </Note>
              </Flag>
            )}

            {bfPoints.length >= 2 && (
              <div className="mt-4">
                <p className="label mb-2">Body fat</p>
                <TrendChart points={bfPoints} color="var(--color-carbs)" unit="%" decimals={1} />
              </div>
            )}

            {!comp.settled && (
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
                {comp.scans} of {SCAN_MIN_POINTS}+ scans. Body fat starts steering the plan after
                about three weeks of them — before that it&rsquo;s mostly how hydrated you were.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button className="btn btn-sm" onClick={() => setEditing(true)}>
                {scannedToday ? "Edit today's scan" : "Log a scan"}
              </button>
            </div>

            <Note label="How much to trust these">Good for the trend; the number itself is ±{SCAN_ERROR} points.</Note>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-mut)]">
              Nothing scanned yet. First thing on {scanDows.map((d) => DOW_LABELS[d]).join(" or ")}
              , stand on the scale holding the handle, and type in what it shows.
            </p>
            <button className="btn btn-sm mt-3" onClick={() => setEditing(true)}>
              Log a scan
            </button>
          </>
        )}
      </section>

      {/* Keeping you on track — both readings against the goal, and the one
          thing Monday will do about it. */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline gap-2">
          <p className="label mr-auto">Keeping you on track</p>
          <span className="text-xs text-[var(--color-mut)]">{goalDef(profile.goal).label}</span>
        </div>

        <div className="mt-3 space-y-2.5">
          <StatusRow
            label="Weight"
            value={rate ? `${signed(rate.kgPerWeek, 2)} ±${rate.seKgPerWeek.toFixed(2)} kg/wk` : "—"}
            aimText={weightAimText(aim.weight, rate?.current ?? trendNow)}
            reading={steer.weight}
            waiting={`${rate?.readings ?? 0} of ${STEER_MIN_READINGS} weigh-ins, over two weeks`}
          />
          <StatusRow
            label="Body fat"
            value={
              signals.comp?.settled
                ? `${signed(signals.comp.bfPtsPerMonth, 1)} ±${signals.comp.bfSePtsPerMonth.toFixed(1)}%/mo`
                : "—"
            }
            aimText={bfAimText(aim.bf)}
            reading={steer.bf}
            waiting={
              signals.comp
                ? `${signals.comp.scans} scans so far — joins in after ~2½ weeks`
                : "starts with your first scan"
            }
          />
        </div>

        {/* Where the recomposition stops, and by when. On the scale's own terms,
            because that's the only body fat figure this app has. */}
        {profile.goal === "recomp" && (
          <div className="mt-4 rounded-xl px-4 py-3" style={{ background: "#0e1013" }}>
            <p className="text-sm font-semibold">Body fat target</p>
            <div className="mt-2 grid grid-cols-[5.5rem_1fr] items-center gap-2">
              <div className="flex items-center gap-1.5">
                <NumberField
                  step={0.5}
                  allowEmpty
                  className="w-full px-2 py-1.5 text-right text-sm"
                  placeholder="none"
                  aria-label="Body fat target, per cent"
                  value={targetDraft === undefined ? profile.bf_target_pct : targetDraft}
                  onCommit={(v) => setTargetDraft(v)}
                />
                <span className="text-sm text-[var(--color-mut)]">%</span>
              </div>
              <label className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm text-[var(--color-mut)]">by</span>
                <input
                  type="date"
                  className="field min-w-0 flex-1 px-2 py-1.5 text-sm"
                  aria-label="Reach it by"
                  value={(dateDraft === undefined ? profile.bf_target_by : dateDraft) ?? ""}
                  onChange={(e) => setDateDraft(e.target.value || null)}
                />
              </label>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
              {steer.atTarget
                ? "You're there — holding you in range, fully fuelled."
                : aim.needPtsPerMonth != null
                  ? `About ${lastScan ? lastScan.bfPct.toFixed(1) : "?"}% now · needs −${aim.needPtsPerMonth.toFixed(1)} points a month, about ${Math.round((((aim.needPtsPerMonth / 100) * planWeight(profile) * 7700) / 30.44) / 5) * 5} kcal a day under maintenance.`
                  : lastScan
                    ? `About ${lastScan.bfPct.toFixed(1)}% now.`
                    : "On your scale."}
            </p>
            {((targetDraft !== undefined && targetDraft !== profile.bf_target_pct) ||
              (dateDraft !== undefined && dateDraft !== profile.bf_target_by)) && (
              <button
                className="btn btn-sm btn-accent mt-3 w-full"
                onClick={async () => {
                  await patch(
                    {
                      ...(targetDraft !== undefined ? { bf_target_pct: targetDraft } : {}),
                      ...(dateDraft !== undefined ? { bf_target_by: dateDraft } : {}),
                    },
                    "Target saved — next week re-worked"
                  );
                  setTargetDraft(undefined);
                  setDateDraft(undefined);
                  await load();
                }}
              >
                Save target
              </button>
            )}
            <Note label="What happens there">
              The pace comes from the weeks you have left — tapers and time off count for less —
              and is capped so it never gets too fast. At the target it holds you there, fully
              fuelled. International swimmers sit around 8–12%.
            </Note>
          </div>
        )}

        {/* The decision — the staged one once review day has been, otherwise
            what it would be with today's data. */}
        {(() => {
          const shown = decided && !decided.dismissed ? decided : null;
          const head = shown ? shown.headline : steer.headline;
          const detail = shown ? shown.detail : steer.detail;
          const tone = shown ? shown.tone : steer.tone;
          const moving = shown ? shown.moving : steer.moving;
          const kcal = shown ? shown.stepKcal : steer.kcal;
          return (
            <>
              <p className="mt-4 text-[0.7rem] uppercase tracking-wide text-[var(--color-mut)]">
                {shown
                  ? `Decided ${prettyDay(shown.on)} for ${prettyDay(shown.applyOn)}`
                  : schedule
                    ? `If it were decided today · it will be ${prettyDay(schedule.reviewOn)}`
                    : ""}
              </p>
              <div className="mt-1.5 rounded-xl px-4 py-3" style={{ background: "#0e1013" }}>
                <p
                  className="text-sm font-semibold"
                  style={{
                    color:
                      tone === "good"
                        ? "var(--color-accent)"
                        : tone === "bad"
                          ? "var(--color-fat)"
                          : tone === "watch"
                            ? "var(--color-carbs)"
                            : "var(--color-fg)",
                  }}
                >
                  {head}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">{detail}</p>
              </div>

              <p className="mt-3 text-xs leading-relaxed">
                {moving ? (
                  <>
                    <b style={{ color: "var(--color-accent)" }}>
                      {kcal > 0 ? "+" : "−"}
                      {Math.abs(kcal)} kcal a day
                    </b>{" "}
                    <span className="text-[var(--color-mut)]">
                      from {DOW_LABELS[profile.plan_roll_dow]}, taken evenly across every meal.
                    </span>
                  </>
                ) : (
                  <span className="text-[var(--color-mut)]">
                    No change to the calories.
                    {profile.recomp_adjust !== 0 &&
                      ` Running ${steer.totalKcal > 0 ? "+" : "−"}${Math.abs(steer.totalKcal)} kcal from maintenance.`}
                  </span>
                )}
              </p>
            </>
          );
        })()}

        <Note label="How it adjusts">
          Every {DOW_LABELS[reviewDow(profile)]}: gaining fat takes the surplus off, losing too fast adds
          a little back, otherwise nothing moves. Training days keep their carbs.
        </Note>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn-sm" disabled={reviewing} onClick={reviewNow}>
            {reviewing ? "Working it out…" : "Work out next week now"}
          </button>
          <label className="flex items-center gap-2">
            <button
              className="tick"
              data-on={profile.auto_roll}
              aria-pressed={profile.auto_roll}
              onClick={() =>
                patch(
                  { auto_roll: !profile.auto_roll },
                  profile.auto_roll ? "You'll work it out yourself" : "Will work it out every week"
                )
              }
            >
              {profile.auto_roll ? "✓" : ""}
            </button>
            <span className="text-xs text-[var(--color-mut)]">
              Every {DOW_LABELS[reviewDow(profile)]}
            </span>
          </label>
        </div>
      </section>

      {/* Trend weight — the chart, for looking at rather than acting on. */}
      <section className="card px-5 py-5">
        <div className="flex items-start">
          <div className="mr-auto">
            <p className="label">Trend weight</p>
            <p className="num-hero mt-2 text-[2.75rem] sm:text-[3.25rem]">
              {trend.length ? trend[trend.length - 1].trend.toFixed(1) : "—"}
              <span className="ml-1 text-lg font-semibold text-[var(--color-mut)]">kg</span>
            </p>
          </div>
          {rate && (
            <div className="pt-1 text-right">
              <p className="label">Per week</p>
              <p className="num mt-2 text-xl" style={{ color: readingColour(steer.weight) }}>
                {signed(rate.kgPerWeek, 2)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-mut)]">
                {signed(rate.pctPerWeek, 2)}% · {rate.days}d
              </p>
            </div>
          )}
        </div>

        {line.length >= 2 && (
          <div className="mt-4">
            <TrendChart points={line} color="var(--color-accent)" unit="kg" decimals={1} />
          </div>
        )}
        <p className="mt-1 text-[0.68rem] text-[#5b6270]">
          Line is the smoothed trend; grey dots are what the scale actually said.
        </p>
      </section>

    </div>
  );
}

/* -------------------------------------------------------------------- */

/**
 * The scan, as a form laid out like the scale's report.
 *
 * Three to a row on a phone, each box labelled with the scale's own name for
 * it so you can read down the display and across the screen at once. Body fat
 * is first and the only one a scan can't be saved without; the rest are there
 * to be filled in if the scale shows them.
 */
function ScanEntry({
  scan,
  onChange,
  live,
  trendKg,
  weighedToday,
  onSave,
  onCancel,
}: {
  scan: ScanForm;
  onChange: (k: ScanField, v: string) => void;
  live: ReturnType<typeof fromScan>;
  trendKg: number;
  weighedToday: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const bfTyped = scan.bf_pct !== "";
  const bad = bfTyped && !live;

  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2">
        {SCAN_METRICS.map((m) => (
          <MetricInput
            key={m.key}
            m={m}
            value={scan[m.key]}
            onChange={(v) => onChange(m.key, v)}
            required={m.key === "bf_pct"}
          />
        ))}
      </div>

      {bad ? (
        <Flag
          className="mt-3"
          tone="bad"
          title="That body fat won't save"
          detail={`It has to be between ${BF_MIN} and ${BF_MAX}%.`}
        />
      ) : live ? (
        <p className="mt-3 text-xs text-[var(--color-mut)]">
          {live.pct}% of your {trendKg.toFixed(1)} kg trend weight is{" "}
          <b className="text-[#f2f4f7]">{live.leanKg} kg lean</b> and {live.fatKg} kg fat.
        </p>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-mut)]">
          Body fat is the one that matters. The rest fill in the picture if your scale shows them.
        </p>
      )}

      {!weighedToday && (
        <p className="mt-1.5 text-xs" style={{ color: "var(--color-carbs)" }}>
          Put this morning&rsquo;s weight in the weigh-in above too.
        </p>
      )}

      {/* Folded away because it is ten more boxes and none of them is required.
          Open once and the browser keeps it open. */}
      <details className="mt-3 border-t border-[#1c1f25] pt-3">
        <summary className="cursor-pointer text-xs text-[var(--color-mut)]">
          Per body part — optional
        </summary>
        <p className="mt-2 text-xs text-[var(--color-mut)]">
          The five segments off the scale&rsquo;s app, in kilograms. Left and right are worth more
          than either on its own.
        </p>
        <div className="mt-2 space-y-1.5">
          {SEGMENTS.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-[4.5rem] shrink-0 text-[0.7rem] text-[var(--color-mut)]">
                {s.label}
              </span>
              {SEGMENT_FIELDS.map((f) => (
                <label key={f.field} className="sunk min-w-0 flex-1 px-2 pb-1.5 pt-1.5">
                  <span className="block text-[0.6rem] leading-none text-[#5b6270]">
                    {f.label} kg
                  </span>
                  <NumberField
                    step={0.1}
                    allowEmpty
                    className="mt-1 w-full px-1.5 py-1 text-sm"
                    placeholder="—"
                    aria-label={`${s.label} ${f.label} in kg`}
                    value={scan[segmentKey(s.id, f.field)] === ""
                      ? null
                      : Number(scan[segmentKey(s.id, f.field)])}
                    onCommit={(v) =>
                      onChange(segmentKey(s.id, f.field), v == null ? "" : String(v))
                    }
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </details>

      <div className="mt-4 flex gap-2">
        <button className="btn btn-accent flex-1" onClick={onSave} disabled={bad}>
          {live ? `Save scan · ${live.pct}%` : "Save scan"}
        </button>
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <Note label="Which numbers?">Type what the scale shows. Weight comes from the weigh-in.</Note>
    </div>
  );
}

function MetricInput({
  m,
  value,
  onChange,
  required,
}: {
  m: ScanMetric;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label
      className="sunk block min-w-0 px-2.5 pb-2 pt-2"
      style={required ? { boxShadow: "inset 0 0 0 1px var(--color-accent)" } : undefined}
    >
      {/* Two lines of room, not an ellipsis: the name is how you find the
          figure on the scale's display, and "Subcutaneous…" is no use. */}
      <span
        className="block min-h-[1.65rem] text-[0.66rem] leading-tight"
        style={{ color: required ? "var(--color-accent)" : "var(--color-mut)" }}
      >
        {m.label}
        {m.unit && <span className="text-[#5b6270]"> {m.unit}</span>}
      </span>
      <NumberField
        step={m.step}
        allowEmpty
        className="mt-1 w-full px-2 py-1.5 text-sm"
        placeholder="—"
        aria-label={`${m.label}${m.unit ? ` in ${m.unit}` : ""}`}
        value={value === "" ? null : Number(value)}
        onCommit={(v) => onChange(v == null ? "" : String(v))}
      />
    </label>
  );
}

/**
 * The last scan, as a grid of figures the way the scale shows them — with how
 * each has moved since the first scan in view, coloured by which way is good.
 */
function ScanReadout({
  comp,
  heightCm,
}: {
  comp: NonNullable<ReturnType<typeof composition>>;
  heightCm: number;
}) {
  const cur = comp.current;
  const first = comp.first;
  const multi = comp.points.length >= 2;

  type Tile = {
    key: string;
    label: string;
    value: string;
    unit: string;
    change: number | null;
    decimals: number;
    better: "down" | "up" | null;
    hero?: boolean;
  };

  const tiles: Tile[] = [
    {
      key: "bf",
      label: "Body fat",
      value: cur.bfPct.toFixed(1),
      unit: "%",
      change: multi ? cur.bfPct - first.bfPct : null,
      decimals: 1,
      better: "down",
      hero: true,
    },
    {
      key: "lean",
      label: "Lean mass",
      value: cur.leanKg.toFixed(1),
      unit: "kg",
      change: multi ? cur.leanKg - first.leanKg : null,
      decimals: 1,
      better: "up",
    },
    {
      key: "fat",
      label: "Fat mass",
      value: cur.fatKg.toFixed(1),
      unit: "kg",
      change: multi ? cur.fatKg - first.fatKg : null,
      decimals: 1,
      better: "down",
    },
  ];

  for (const m of EXTRA_METRICS) {
    const v = cur.extras[m.key];
    if (v == null) continue;
    const ch = extraChange(comp, m.key);
    tiles.push({
      key: m.key,
      label: m.label,
      value: m.decimals === 0 ? Math.round(v).toLocaleString() : v.toFixed(m.decimals),
      unit: m.unit,
      change: ch && ch.to === v ? ch.change : null,
      decimals: m.decimals,
      better: m.better,
    });
  }

  const b = bmi(cur.weightKg, heightCm);
  if (b != null) {
    tiles.push({
      key: "bmi",
      label: "BMI",
      value: b.toFixed(1),
      unit: "",
      change: null,
      decimals: 1,
      better: null,
    });
  }

  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.key} className="sunk min-w-0 px-2.5 py-2">
            <p className="min-h-[1.65rem] text-[0.66rem] leading-tight text-[var(--color-mut)]">
              {t.label}
            </p>
            <p
              className="num mt-1 truncate text-base"
              style={t.hero ? { color: "var(--color-accent)" } : undefined}
            >
              {t.value}
              {t.unit && (
                <span className="ml-0.5 text-[0.66rem] font-semibold text-[var(--color-mut)]">
                  {t.unit}
                </span>
              )}
            </p>
            {t.change != null && Math.abs(t.change) >= 10 ** -t.decimals / 2 && (
              <p
                className="mt-0.5 text-[0.62rem] tabular-nums"
                style={{ color: changeColour(t.change, t.better) }}
              >
                {signed(t.change, t.decimals)}
              </p>
            )}
          </div>
        ))}
      </div>
      {multi && (
        <p className="mt-2 text-[0.68rem] text-[#5b6270]">
          Changes since {prettyDay(first.day)}. Lean and fat are split from your trend weight.
        </p>
      )}
      <SegmentMap comp={comp} />
    </div>
  );
}

/**
 * Where the muscle is — the five segments, laid out as a body rather than a
 * list, with each side's figures next to its opposite number.
 *
 * Left beside right on the same row is the whole point. The absolute figure for
 * one arm is the least trustworthy thing on this page; the DIFFERENCE between
 * two arms is one of the most, because whatever the scale gets wrong about you
 * it gets wrong on both sides at once. So the pairs are adjacent, and the gap
 * between them is called out in words underneath.
 */
function SegmentMap({ comp }: { comp: NonNullable<ReturnType<typeof composition>> }) {
  const cur = comp.current.extras;
  const first = comp.first.extras;
  const multi = comp.points.length >= 2;

  const rows = SEGMENTS.map((s) => ({
    seg: s,
    muscle: cur[segmentKey(s.id, "muscle_kg")] ?? null,
    fat: cur[segmentKey(s.id, "fat_kg")] ?? null,
    wasMuscle: first[segmentKey(s.id, "muscle_kg")] ?? null,
    ratio: segmentRatio(cur, s.id),
  }));
  if (!rows.some((r) => r.muscle != null || r.fat != null)) return null;

  /** The biggest left-right muscle gap, as a share of the bigger side. */
  const gaps = SEGMENTS.filter((s) => s.side === "left" && s.mirror).map((s) => {
    const l = cur[segmentKey(s.id, "muscle_kg")];
    const r = cur[segmentKey(s.mirror!, "muscle_kg")];
    if (l == null || r == null || !(Math.max(l, r) > 0)) return null;
    return { label: s.label.replace("Left ", ""), l, r, pct: (Math.abs(l - r) / Math.max(l, r)) * 100 };
  });
  const worst = gaps
    .filter((g): g is NonNullable<typeof g> => g != null)
    .sort((a, b) => b.pct - a.pct)[0];

  return (
    <details className="mt-3 border-t border-[#1c1f25] pt-3">
      <summary className="cursor-pointer text-xs text-[var(--color-mut)]">
        Where it sits — per body part
      </summary>
      <div className="mt-2 space-y-1">
        {rows.map((r) => (
          <div key={r.seg.id} className="flex items-center gap-2 text-[0.72rem]">
            <span className="w-[4.5rem] shrink-0 text-[var(--color-mut)]">{r.seg.label}</span>
            <span className="num w-[3.6rem] shrink-0 text-right">
              {r.muscle == null ? "—" : `${r.muscle.toFixed(2)}`}
              <span className="ml-0.5 text-[0.6rem] text-[#5b6270]">kg</span>
            </span>
            {multi && r.muscle != null && r.wasMuscle != null ? (
              <span
                className="w-[2.8rem] shrink-0 text-right text-[0.62rem] tabular-nums"
                style={{ color: changeColour(r.muscle - r.wasMuscle, "up") }}
              >
                {signed(r.muscle - r.wasMuscle, 2)}
              </span>
            ) : (
              <span className="w-[2.8rem] shrink-0" />
            )}
            <span className="flex-1 text-right text-[#5b6270]">
              {r.fat == null ? "" : `${r.fat.toFixed(2)} kg fat`}
              {r.ratio != null && ` · ${r.ratio.toFixed(2)} fat:muscle`}
            </span>
          </div>
        ))}
      </div>
      {worst && (
        <p className="mt-2 text-[0.68rem] text-[#5b6270]">
          {worst.pct < 3
            ? `Arms and legs are even — the biggest gap is ${worst.pct.toFixed(1)}% across the ${worst.label}s.`
            : `Your ${worst.l > worst.r ? "left" : "right"} ${worst.label} carries ${worst.pct.toFixed(1)}% more muscle than the other. Worth watching across a few scans before reading anything into it.`}
        </p>
      )}
      <p className="mt-1 text-[0.68rem] text-[#5b6270]">
        Shown, not steered on. These move around between scans far more than the whole-body
        figures do.
      </p>
    </details>
  );
}

/** One reading against its aim: the number, what it's aiming for, and a verdict word. */
function StatusRow({
  label,
  value,
  aimText,
  reading,
  waiting,
}: {
  label: string;
  value: string;
  aimText: string;
  reading: Reading;
  waiting: string;
}) {
  const word =
    reading === "in"
      ? "on track"
      : reading === "low"
        ? "below aim"
        : reading === "high"
          ? "above aim"
          : "waiting";
  return (
    <div className="sunk px-3.5 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="w-16 shrink-0 text-xs text-[var(--color-mut)]">{label}</span>
        <span className="num min-w-0 flex-1 truncate text-sm">{value}</span>
        <span className="shrink-0 text-xs font-semibold" style={{ color: readingColour(reading) }}>
          {word}
        </span>
      </div>
      <p className="mt-0.5 pl-[4.5rem] text-[0.68rem] leading-snug text-[#5b6270]">
        {reading === "unknown" ? waiting : `aim: ${aimText}`}
      </p>
    </div>
  );
}

function readingColour(r: Reading): string {
  return r === "in"
    ? "var(--color-accent)"
    : r === "unknown"
      ? "var(--color-mut)"
      : "var(--color-carbs)";
}

function changeColour(change: number, better: "down" | "up" | null): string {
  if (better == null || change === 0) return "var(--color-mut)";
  const good = better === "down" ? change < 0 : change > 0;
  return good ? "var(--color-accent)" : "var(--color-carbs)";
}

/** "+0.12", "−0.40", "0.0" — a real minus sign, and no sign on zero. */
function signed(n: number, dp: number): string {
  const r = Number(n.toFixed(dp));
  if (r === 0) return (0).toFixed(dp);
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(dp)}`;
}

function weightAimText([lo, hi]: [number, number], kg: number): string {
  const a = (lo / 100) * kg;
  const b = (hi / 100) * kg;
  if (lo < 0 && hi > 0) return `${signed(a, 2)} to ${signed(b, 2)} kg a week`;
  if (hi <= 0) return `down ${Math.abs(b).toFixed(2)}–${Math.abs(a).toFixed(2)} kg a week`;
  if (lo <= 0) return `steady, or up to ${b.toFixed(2)} kg a week`;
  return `up ${a.toFixed(2)}–${b.toFixed(2)} kg a week`;
}

function bfAimText([lo, hi]: [number, number]): string {
  if (lo < 0 && hi > 0) return `steady — no more than +${hi.toFixed(1)}% a month`;
  if (hi <= 0) return `down ${Math.abs(hi).toFixed(1)}–${Math.abs(lo).toFixed(1)}% a month`;
  return `up ${lo.toFixed(1)}–${hi.toFixed(1)}% a month`;
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
