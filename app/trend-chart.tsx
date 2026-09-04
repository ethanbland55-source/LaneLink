"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChartPoint = { day: string; value: number | null; trend: number };

/**
 * Weight over time: the trend line is the series, the daily readings are
 * context behind it.
 *
 * The daily dots are deliberately in muted ink rather than a second colour —
 * they aren't a series you compare against anything, they're the noise the
 * trend is drawn through, and giving them a hue would imply otherwise. Weight
 * and waist get their own charts rather than sharing one plot with two scales,
 * because a second y-axis invents a correlation that isn't in the data.
 */
export function TrendChart({
  points,
  color,
  unit,
  decimals = 1,
  height = 168,
}: {
  points: ChartPoint[];
  color: string;
  unit: string;
  decimals?: number;
  height?: number;
}) {
  /**
   * A callback ref, not `useRef` plus an effect, and it matters.
   *
   * This component returns a different element while it is waiting for enough
   * readings to draw a line. The observer was set up in an effect with an
   * empty dependency list, so on a page that starts empty and fills in — which
   * is every page here, the data arrives over fetch — the effect ran once
   * against the placeholder, found no node to watch, and returned. The chart
   * mounted afterwards with nothing observing it, so the width stayed at
   * whatever it was initialised to for the life of the page.
   *
   * That is why the Progress page hung 300 pixels off the side of a phone: a
   * 640px chart in a 303px card, quietly, only once you had weighed in enough
   * times for the chart to exist at all.
   *
   * A callback ref runs whenever the node changes — placeholder to chart and
   * back — so the observer follows the element instead of a moment in time.
   */
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);

  // Render at real pixel size rather than scaling a viewBox, so the labels
  // stay the size they were designed at.
  const wrap = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const now = el.getBoundingClientRect().width;
    if (now > 0) setWidth(Math.max(240, now));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    observer.current = ro;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  const pad = { top: 10, right: 54, bottom: 22, left: 8 };

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals: number[] = [];
    for (const p of points) {
      vals.push(p.trend);
      if (p.value != null) vals.push(p.value);
    }
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const span = hi - lo || 1;
    lo -= span * 0.18;
    hi += span * 0.18;

    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const x = (i: number) => pad.left + (i / (points.length - 1)) * w;
    const y = (v: number) => pad.top + h - ((v - lo) / (hi - lo)) * h;

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.trend)}`).join(" ");
    const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];

    return { x, y, path, ticks, w, h };
  }, [points, width, height]);

  if (!geo) {
    return (
      <div ref={wrap} className="sunk flex items-center justify-center px-4" style={{ height }}>
        <p className="text-xs text-[var(--color-mut)]">
          A couple of weeks of readings and the trend appears here.
        </p>
      </div>
    );
  }

  const last = points[points.length - 1];
  const active = hover != null ? points[hover] : null;
  const fmt = (v: number) => v.toFixed(decimals);

  return (
    <div ref={wrap} className="relative w-full max-w-full overflow-hidden">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Trend over ${points.length} days, currently ${fmt(last.trend)} ${unit}`}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = e.clientX - box.left - pad.left;
          const i = Math.round((rel / geo.w) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {/* Recessive solid hairlines — never dashed, that reads as a threshold. */}
        {geo.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={pad.left + geo.w}
              y1={geo.y(t)}
              y2={geo.y(t)}
              stroke="#1c1f25"
              strokeWidth={1}
            />
            <text
              x={pad.left + geo.w + 6}
              y={geo.y(t) + 3.5}
              fontSize="10"
              fill="#5b6270"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmt(t)}
            </text>
          </g>
        ))}

        {/* The readings themselves, behind the trend. */}
        {points.map((p, i) =>
          p.value == null ? null : (
            <circle key={i} cx={geo.x(i)} cy={geo.y(p.value)} r={1.8} fill="#3d434e" />
          )
        )}

        <path d={geo.path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />

        {/* Endpoint, direct-labelled — the one value worth writing on the plot. */}
        <circle
          cx={geo.x(points.length - 1)}
          cy={geo.y(last.trend)}
          r={4}
          fill={color}
          stroke="var(--color-surface)"
          strokeWidth={2}
        />

        {active && (
          <g>
            <line
              x1={geo.x(hover!)}
              x2={geo.x(hover!)}
              y1={pad.top}
              y2={pad.top + geo.h}
              stroke="#2f353f"
              strokeWidth={1}
            />
            <circle
              cx={geo.x(hover!)}
              cy={geo.y(active.trend)}
              r={4}
              fill={color}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </g>
        )}

        <text x={pad.left} y={height - 6} fontSize="10" fill="#5b6270">
          {shortDay(points[0].day)}
        </text>
        <text x={pad.left + geo.w} y={height - 6} fontSize="10" fill="#5b6270" textAnchor="end">
          {shortDay(last.day)}
        </text>
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg bg-[#1e222a] px-2.5 py-1.5 text-[0.7rem] shadow-lg"
          style={{
            left: Math.min(width - 132, Math.max(0, geo.x(hover!) - 60)),
          }}
        >
          <span className="text-[var(--color-mut)]">{shortDay(active.day)}</span>{" "}
          <b style={{ color }}>
            {fmt(active.trend)} {unit}
          </b>
          {active.value != null && (
            <span className="text-[var(--color-mut)]"> · read {fmt(active.value)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function shortDay(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
