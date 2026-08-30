"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Segmented, Stat } from "../macro-ui";
import { TrendChart } from "../trend-chart";
import {
  buildWeekPlan,
  dayKey,
  estimatedBodyFat,
  normaliseDayType,
  type DayType,
  type Profile,
} from "@/lib/nutrition";
import { normaliseProfile } from "@/lib/profile";
import {
  TAGS,
  calibrate,
  learnOffsets,
  recompVerdict,
  trendLine,
  waistRate,
  weightRate,
  type IntakeDay,
  type Tag,
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
  const [waist, setWaist] = useState("");
  const [tag, setTag] = useState<Tag>("morning");

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
    const mine = (w as WeighIn[]).find((e) => e.day === dayKey());
    setWeight(mine?.weight_kg != null ? String(mine.weight_kg) : "");
    setWaist(mine?.waist_cm != null ? String(mine.waist_cm) : "");
    setTag(mine?.tag ?? "morning");
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
  const bodyFat = useMemo(() => (profile ? estimatedBodyFat(profile) : null), [profile]);

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
    const body = {
      day: today,
      weight_kg: weight ? Number(weight) : null,
      waist_cm: waist ? Number(waist) : null,
      tag,
    };
    await fetch("/api/weigh-ins", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
    say("Logged");
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

  if (loading || !profile || !plan) {
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

      {/* Log today */}
      <section className="card px-5 py-5">
        <p className="label">This morning</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Weight (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              className="field w-28"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--color-mut)]">Waist (cm)</span>
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              className="field w-28"
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
            />
          </label>
          <button className="btn btn-accent" onClick={saveWeighIn}>
            Save
          </button>
        </div>

        <div className="mt-4">
          <p className="label mb-2">When</p>
          <Segmented
            size="sm"
            value={tag}
            onChange={setTag}
            options={TAGS.map((t) => ({ value: t.value, label: t.label, hint: t.hint }))}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
          You don't have to weigh at the same time every day. Say when you did it and the reading
          is corrected to what it would have been first thing before it touches the trend —
          otherwise an evening weigh-in reads about a kilo heavier and drags the line around for a
          week. The waist only needs doing once a week, at the navel, relaxed on the out-breath.
        </p>

        {(offsets.counts.evening > 0 || offsets.counts.other > 0) && (
          <p className="mt-2 text-xs leading-relaxed text-[#5b6270]">
            {offsets.learned.length > 0
              ? `Measured on you: your ${offsets.learned
                  .map(
                    (t) =>
                      `${t === "other" ? "daytime" : t} readings run ${offsets.weight[t].toFixed(1)} kg heavier`
                  )
                  .join(", ")}. That's subtracted before the trend sees them.`
              : "Using a typical time-of-day correction for now — once there are a few more readings it switches to one measured on you."}
          </p>
        )}
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

      {/* Body fat */}
      {profile.bf_source !== "none" && (
        <section className="card px-5 py-5">
          <div className="flex items-baseline">
            <p className="label mr-auto">Body fat</p>
            {bodyFat && <span className="num text-lg">{bodyFat.pct}%</span>}
          </div>
          {bodyFat ? (
            <>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Stat label="Lean" value={`${bodyFat.leanKg} kg`} accent />
                <Stat label="Fat" value={`${bodyFat.fatKg} kg`} />
                <Stat
                  label="From"
                  value={bodyFat.method === "measured" ? "Measured" : "Tape"}
                  sub={bodyFat.error > 0 ? `±${bodyFat.error} pts` : undefined}
                />
              </div>
              {bodyFat.method === "Navy tape" && (
                <p className="mt-3 text-xs leading-relaxed text-[var(--color-mut)]">
                  Estimated from your height, neck and latest waist. It's worth ±3–4 points against
                  a scan, but most of that error is a fixed offset for your build — so treat the
                  percentage as approximate and the direction it moves as real. It updates itself
                  every time you log a waist.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-carbs)" }}>
              Add a neck measurement on the Plan page and log a waist above, and this fills itself
              in from then on.
            </p>
          )}
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
                          {TAGS.find((t) => t.value === (e.tag ?? "morning"))?.label ?? "—"}
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
