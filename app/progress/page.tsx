"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented, Stat } from "../macro-ui";
import { TrendChart } from "../trend-chart";
import {
  ageFromDob,
  buildWeekPlan,
  dayKey,
  normaliseDayType,
  planWeight,
  type DayType,
  type Profile,
} from "@/lib/nutrition";
import { DOW_LABELS, normaliseProfile } from "@/lib/profile";
import {
  BF_METHODS,
  MEASURE_SITES,
  navyBodyFat,
  sitesFor,
  skinfoldBodyFat,
  type BfMethod,
} from "@/lib/bodyfat";
import { applyRoll, rollDelta, rollState } from "@/lib/weekly";
import {
  DEFAULT_RISE_PER_HOUR,
  calibrate,
  hoursAwake,
  learnOffsets,
  parseClock,
  recompVerdict,
  riseAt,
  trendLine,
  waistRate,
  weightRate,
  type IntakeDay,
  type WeighIn,
} from "@/lib/trend";

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
  const [bfMethod, setBfMethod] = useState<BfMethod>("tape");
  const [manualBf, setManualBf] = useState("");
  /** Every tape and caliper reading for today, keyed by column name. */
  const [sites, setSites] = useState<Record<string, string>>({});

  function setSite(key: string, v: string) {
    setSites((s) => ({ ...s, [key]: v }));
  }

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
    // silently wipes the measurements taken earlier.
    const mine = (w as any[]).find((e) => e.day === dayKey());
    setWeight(mine?.weight_kg != null ? String(mine.weight_kg) : "");
    setAtTime(mine?.at_time ?? "");
    const next: Record<string, string> = {};
    for (const k of Object.keys(MEASURE_SITES)) {
      if (mine?.[k] != null) next[k] = String(mine[k]);
    }
    setSites(next);
    if (mine?.bf_method) setBfMethod(mine.bf_method as BfMethod);
    if (mine?.bf_method === "manual" && mine?.bf_pct != null) setManualBf(String(mine.bf_pct));
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
  const waistTrend = useMemo(() => waistRate(entries), [entries]);
  const verdict = useMemo(() => recompVerdict(rate, waistTrend), [rate, waistTrend]);

  const cal = useMemo(
    () => (plan ? calibrate(entries, intake, plan.maintenance) : null),
    [entries, intake, plan]
  );

  const offsets = useMemo(() => learnOffsets(entries), [entries]);

  /**
   * Body fat from what's in the form right now, so the number moves as you
   * type rather than only after saving. Uses the same functions the API does,
   * so the preview and the stored figure can never disagree.
   */
  const liveBf = useMemo(() => {
    if (!profile) return null;
    const n = (k: string) => {
      const v = Number(sites[k]);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    const kg = Number(weight) > 20 ? Number(weight) : planWeight(profile);

    if (bfMethod === "manual") {
      const pct = Number(manualBf);
      if (!(pct >= 3 && pct <= 60)) return null;
      return {
        pct: Math.round(pct * 10) / 10,
        leanKg: Math.round(kg * (1 - pct / 100) * 10) / 10,
        fatKg: Math.round(kg * (pct / 100) * 10) / 10,
        error: 0,
        label: "Your scan",
      };
    }
    if (bfMethod === "skinfold") {
      const keys = sitesFor("skinfold", profile.sex);
      const vals = keys.map(n);
      if (vals.some((v) => v == null)) return null;
      const est = skinfoldBodyFat({
        sex: profile.sex,
        ageYears: ageFromDob(profile.dob),
        sites: vals as number[],
        weightKg: kg,
      });
      return est ? { ...est, label: "Calipers" } : null;
    }
    const est = navyBodyFat({
      sex: profile.sex,
      heightCm: profile.height_cm,
      neckCm: n("neck_cm") ?? 0,
      waistCm: n("waist_cm") ?? 0,
      hipCm: n("hip_cm"),
      weightKg: kg,
    });
    return est ? { ...est, label: "Tape" } : null;
  }, [profile, sites, weight, bfMethod, manualBf]);

  /** Every body fat figure ever measured, oldest first. */
  const bfHistory = useMemo(
    () =>
      (entries as any[])
        .filter((e) => e.bf_pct != null)
        .map((e) => ({ day: e.day as string, pct: Number(e.bf_pct) }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    [entries]
  );

  const roll = useMemo(
    () => (profile ? rollState(profile, entries, today) : null),
    [profile, entries, today]
  );
  const rollMove = useMemo(
    () => (profile && roll?.figures ? rollDelta(profile, roll.figures) : { kg: 0, bf: null }),
    [profile, roll]
  );

  const waistPoints = useMemo(() => {
    const pts = entries
      .filter((e) => e.waist_cm != null && Number(e.waist_cm) > 0)
      .map((e) => ({ day: e.day, value: Number(e.waist_cm), trend: Number(e.waist_cm) }))
      .sort((a, b) => a.day.localeCompare(b.day));
    // Light smoothing — the tape is measured weekly, so it needs far less.
    let t = pts[0]?.value ?? 0;
    return pts.map((p) => {
      t = t + 0.4 * (p.value - t);
      return { ...p, trend: t };
    });
  }, [entries]);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  }

  async function saveWeighIn() {
    const body: Record<string, unknown> = {
      day: today,
      weight_kg: weight ? Number(weight) : null,
      at_time: atTime || null,
      bf_method: bfMethod,
      bf_pct: bfMethod === "manual" && manualBf ? Number(manualBf) : null,
    };
    for (const [k, v] of Object.entries(sites)) body[k] = v === "" ? null : Number(v);

    await fetch("/api/weigh-ins", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
    say(liveBf ? `Logged — ${liveBf.pct}% body fat` : "Logged");
  }

  /**
   * Rebuild this week's targets from the trend.
   *
   * Stamped with the shopping day it is *for*, not today, so pressing it on a
   * Tuesday still counts as this week's roll and it won't ask again until the
   * next shopping day comes round.
   */
  async function doRoll() {
    if (!profile || !roll?.figures) return;
    const next = applyRoll(profile, roll.figures, roll.dueOn);
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    say(`Plan rebuilt on ${next.plan_weight_kg} kg`);
  }

  async function setAutoRoll(on: boolean) {
    if (!profile) return;
    const next: Profile = { ...profile, auto_roll: on };
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    say(on ? "Will rebuild on shopping day" : "You'll rebuild it yourself");
  }

  async function acceptCalibration(on: boolean) {
    if (!profile || !cal) return;
    const next: Profile = {
      ...profile,
      calibrated_tdee: on ? cal.tdee : profile.calibrated_tdee,
      use_calibration: on,
    };
    setProfile(next);
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    say(on ? "Using your own numbers" : "Back to the formula");
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

      {/* Today's weigh-in */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Weigh in</p>
          <p className="text-xs text-[var(--color-mut)]">{prettyDay(today)}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Measure
            label="Weight"
            unit="kg"
            value={weight}
            onChange={setWeight}
            step={0.1}
          />
          <Measure
            label="Waist"
            unit="cm"
            value={sites.waist_cm ?? ""}
            onChange={(v: string) => setSite("waist_cm", v)}
            step={0.1}
          />
        </div>

        {/* When. A real clock time, because 09:00 and 11:30 are both "morning"
            and are not the same reading. */}
        <div className="mt-4">
          <p className="label mb-2">What time</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="time"
              className="field w-32"
              aria-label="Time you weighed in"
              value={atTime}
              onChange={(e) => setAtTime(e.target.value)}
            />
            <button className="btn btn-sm" onClick={() => setAtTime(nowClock())}>
              Now
            </button>
            <span className="text-xs text-[var(--color-mut)]">
              {atTime ? riseNote(atTime, offsets.risePerHour) : "so it can be corrected"}
            </span>
          </div>
        </div>

        <button className="btn btn-accent mt-4 w-full" onClick={saveWeighIn}>
          Save
        </button>

        <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
          You don&rsquo;t have to weigh at the same time every day — say when you did and the
          reading is corrected to what it would have been first thing before it touches the trend.
          You gain about a kilo through the day and none of it is fat.
        </p>

        {offsets.measured ? (
          <p className="mt-2 text-xs leading-relaxed text-[#5b6270]">
            Measured on you: about{" "}
            <b>{(offsets.risePerHour * 1000).toFixed(0)} g an hour</b> awake
            {offsets.timed > 0 && `, from ${offsets.timed} timed reading${offsets.timed === 1 ? "" : "s"}`}
            . That&rsquo;s taken off before the trend sees them.
          </p>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-[#5b6270]">
            Using a typical correction of {(DEFAULT_RISE_PER_HOUR * 1000).toFixed(0)} g an hour for
            now. Log a few at different times and it switches to one measured on you.
          </p>
        )}
      </section>

      {/* Body fat from measurements */}
      <section className="card px-5 py-5">
        <div className="flex items-baseline">
          <p className="label mr-auto">Body fat</p>
          {liveBf && (
            <p className="num text-lg" style={{ color: "var(--color-accent)" }}>
              {liveBf.pct}%
            </p>
          )}
        </div>

        <div className="mt-3">
          <Segmented
            size="sm"
            value={bfMethod}
            onChange={(v) => setBfMethod(v)}
            options={BF_METHODS.map((m) => ({ value: m.value, label: m.label, hint: m.blurb }))}
          />
          <p className="mt-2 text-xs text-[var(--color-mut)]">
            {BF_METHODS.find((m) => m.value === bfMethod)?.blurb}
          </p>
        </div>

        {bfMethod === "manual" ? (
          <div className="mt-4 max-w-[10rem]">
            <Measure
              label="Body fat"
              unit="%"
              value={manualBf}
              onChange={setManualBf}
              step={0.1}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {sitesFor(bfMethod, profile.sex).map((key) => {
              const site = MEASURE_SITES[key];
              if (!site) return null;
              return (
                <div key={key} className="sunk px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="mr-auto text-sm font-medium">{site.label}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step={0.1}
                      aria-label={`${site.label} in ${site.unit}`}
                      className="field w-24 text-right"
                      value={sites[key] ?? ""}
                      onChange={(e) => setSite(key, e.target.value)}
                    />
                    <span className="w-6 text-xs text-[var(--color-mut)]">{site.unit}</span>
                  </div>
                  <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[#5b6270]">{site.where}</p>
                </div>
              );
            })}
          </div>
        )}

        <button className="btn btn-accent mt-4 w-full" onClick={saveWeighIn}>
          {liveBf ? `Save ${liveBf.pct}%` : "Save measurements"}
        </button>

        {liveBf ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Lean" value={`${liveBf.leanKg} kg`} accent />
              <Stat label="Fat" value={`${liveBf.fatKg} kg`} />
              <Stat
                label="From"
                value={liveBf.label}
                sub={liveBf.error > 0 ? `±${liveBf.error} pts` : undefined}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
              Worth ±{liveBf.error} points against a scan, but most of that error is a fixed offset
              for your build — so treat the percentage as approximate and the direction it moves as
              real. It also can&rsquo;t tell muscle from water: a smaller waist at the same weight
              reads as lean mass up whether or not any appeared.
            </p>
          </>
        ) : (
          <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
            {bfMethod === "manual"
              ? "Type the percentage from your scan."
              : `Fill in ${sitesFor(bfMethod, profile.sex)
                  .map((k) => MEASURE_SITES[k]?.label.toLowerCase())
                  .filter(Boolean)
                  .join(", ")} and it works the rest out.`}
          </p>
        )}

        {bfHistory.length >= 2 && (
          <p className="mt-3 text-xs text-[#5b6270]">
            {bfHistory.length} measurements since {prettyDay(bfHistory[0].day)} —{" "}
            {bfHistory[0].pct}% to {bfHistory[bfHistory.length - 1].pct}%.
          </p>
        )}
      </section>

      {/* What this week's plan is built on */}
      <section className="card px-5 py-5">
        <p className="label">This week&rsquo;s plan</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="num-hero text-[2.5rem]">{roll.current.weightKg.toFixed(1)}</p>
          <p className="text-sm text-[var(--color-mut)]">
            kg
            {roll.current.bodyFatPct != null && ` · ${roll.current.bodyFatPct}% body fat`}
          </p>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
          {roll.current.fromSnapshot
            ? `Taken from your trend on ${prettyDay(roll.lastRolled ?? roll.dueOn)}. Every target, the shopping list and the cook list are built on this figure, and it holds still until ${prettyDay(roll.nextOn)} — so what you buy on shopping day is what you eat all week.`
            : `Your typed-in weight, until there are enough weigh-ins for a trend. From then on this updates itself every ${DOW_LABELS[profile.shop_start_dow]}.`}
        </p>

        {roll.due && roll.figures ? (
          <div className="mt-4 rounded-xl bg-[#2a2416] px-3.5 py-3">
            <p className="text-xs leading-relaxed text-[#ffd08a]">
              Shopping day was {prettyDay(roll.dueOn)} and the plan hasn&rsquo;t been rebuilt since.
              Your trend is now <b>{roll.figures.weightKg.toFixed(1)} kg</b>
              {rollMove.kg !== 0 && ` (${rollMove.kg > 0 ? "+" : ""}${rollMove.kg} kg)`}
              {roll.figures.bodyFatPct != null && ` at ${roll.figures.bodyFatPct}% body fat`}.
            </p>
            <button className="btn btn-sm btn-accent mt-2.5" onClick={doRoll}>
              Rebuild this week&rsquo;s targets
            </button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-[#5b6270]">
            Next update {prettyDay(roll.nextOn)}, your shopping day.
            {roll.figures &&
              ` Your trend is ${roll.figures.weightKg.toFixed(1)} kg right now, from ${roll.figures.readings} weigh-ins.`}
          </p>
        )}

        <label className="mt-4 flex items-center gap-2.5">
          <button
            className="tick"
            data-on={profile.auto_roll}
            aria-pressed={profile.auto_roll}
            onClick={() => setAutoRoll(!profile.auto_roll)}
          >
            {profile.auto_roll ? "✓" : ""}
          </button>
          <span className="text-sm">Rebuild it for me on shopping day</span>
        </label>
      </section>

      {/* Waist */}
      {waistPoints.length >= 3 && waistTrend && (
        <section className="card px-5 py-5">
          <div className="flex items-baseline">
            <p className="label mr-auto">Waist</p>
            <span className="num text-lg">{waistTrend.current.toFixed(1)} cm</span>
          </div>
          <div className="mt-3">
            <TrendChart points={waistPoints} color="var(--color-fibre)" unit="cm" decimals={1} />
          </div>
          <p className="mt-1 text-[0.7rem] text-[#5b6270]">
            {waistTrend.points} measurement{waistTrend.points === 1 ? "" : "s"} over{" "}
            {waistTrend.days} days — weekly is plenty for this to mean something.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
            {waistTrend.cmPerWeek <= -0.05
              ? `Down ${Math.abs(waistTrend.cmPerWeek * 4).toFixed(1)} cm a month. In a recomposition this is the number that moves first — the scale can sit still for weeks while this doesn't.`
              : waistTrend.cmPerWeek >= 0.05
                ? `Up ${(waistTrend.cmPerWeek * 4).toFixed(1)} cm a month.`
                : "Holding steady."}
          </p>
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
              maintenance. Today you're at <b className="text-[#f2f4f7]">{pct(phase.adjust)}</b>,
              which is {plan.goalKcal.toLocaleString()} kcal as a seven-day average.
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

      {/* Calibration */}
      <section className="card px-5 py-5">
        <p className="label">What your maintenance actually is</p>

        {cal ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Formula says" value={plan.maintenance} sub="from BMR + sessions" />
              <Stat label="Your data says" value={cal.tdee} accent sub={`${cal.confidence} confidence`} />
              <Stat
                label="Difference"
                value={`${cal.tdee - plan.maintenance >= 0 ? "+" : ""}${cal.tdee - plan.maintenance}`}
                sub={`${Math.round((cal.factor - 1) * 100)}%`}
              />
            </div>

            <p className="mt-4 text-xs leading-relaxed text-[var(--color-mut)]">
              Over the last {cal.days} days you ate {cal.intake.toLocaleString()} kcal a day on
              average across {cal.intakeDays} logged days, and the trend moved{" "}
              {cal.kgPerWeek >= 0 ? "+" : ""}
              {cal.kgPerWeek.toFixed(2)} kg a week. What you ate minus what you stored is what you
              burned — which is measured on you, rather than predicted from a population.
            </p>

            {cal.confidence === "low" && (
              <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
                Thin data so far — more logged days and daily weigh-ins will tighten this up before
                it's worth acting on.
              </p>
            )}

            <button
              className={`mt-4 w-full ${profile.use_calibration ? "btn" : "btn btn-accent"}`}
              onClick={() => acceptCalibration(!profile.use_calibration)}
            >
              {profile.use_calibration
                ? "Stop using it, go back to the formula"
                : "Use this instead of the formula"}
            </button>

            {profile.use_calibration && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-mut)]">
                Every day type is scaled by the same factor, so the shape of your week — which came
                from your sessions — is unchanged. Come back and press it again after a few more
                weeks to re-fit.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
            Needs about two weeks of daily weigh-ins and confirmed food logs in the same window.
            Then this works out what you actually burn from what you actually ate, which beats any
            prediction equation — they're fitted to populations, and you're one person.
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
                  <th className="pb-2 pr-4 font-semibold">Waist</th>
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
                          {e.weight_kg != null ? e.weight_kg.toFixed(1) : "—"}
                        </td>
                        <td className="py-1.5 pr-4 text-[var(--color-mut)]">
                          {t ? t.trend.toFixed(2) : "—"}
                        </td>
                        <td className="py-1.5 pr-4">
                          {e.waist_cm != null ? e.waist_cm.toFixed(1) : "—"}
                        </td>
                        <td className="py-1.5 text-[var(--color-mut)]">
                          {(e as any).at_time ??
                            (e.tag === "evening" ? "evening" : e.tag === "other" ? "daytime" : "morning")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
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

/** One labelled number box. Used for weight, waist and every measurement site. */
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
      <input
        type="number"
        inputMode="decimal"
        step={step}
        className="field w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
