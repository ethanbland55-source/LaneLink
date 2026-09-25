"use client";

import { useState } from "react";
import { Sheet } from "./sheet";
import { Segmented } from "./macro-ui";
import { TAPERS, addDays, breakOn, type PlanEvent, type Taper } from "@/lib/nutrition";

function pretty(d: string, withMonth = true): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    ...(withMonth ? { month: "short" } : {}),
  });
}

function span(e: PlanEvent): string {
  return e.start === e.end ? pretty(e.start) : `${pretty(e.start, false)} – ${pretty(e.end)}`;
}

/**
 * Time off and meets, where they're easy to reach: under the day's number on
 * Today. Two buttons, and whatever's coming up.
 *
 * Time off turns those days into rest days (rest-day food, a shopping list
 * without the pre-swim snacks) and the review reads round it. A meet protects
 * its taper by how hard you're tapering. See `PlanEvent` in lib/nutrition.ts.
 */
export function CalendarStrip({
  events,
  today,
  onSave,
}: {
  events: PlanEvent[];
  today: string;
  onSave: (next: PlanEvent[]) => Promise<void>;
}) {
  const [adding, setAdding] = useState<PlanEvent["kind"] | null>(null);
  const [busy, setBusy] = useState(false);
  const off = breakOn(events, today);
  const coming = events.filter((e) => e.end >= today).slice(0, 5);

  async function save(next: PlanEvent[]) {
    setBusy(true);
    await onSave(next);
    setBusy(false);
  }

  return (
    <>
      {off && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#0e1013] px-3.5 py-2.5">
          <p className="mr-auto min-w-0 text-sm">
            <b>{off.name}</b>
            <span className="text-[var(--color-mut)]"> · rest-day food until {pretty(off.end)}</span>
          </p>
          <button
            className="btn btn-sm shrink-0"
            disabled={busy}
            onClick={() =>
              save(
                events.flatMap((e) =>
                  e !== off ? [e] : e.start >= today ? [] : [{ ...e, end: addDays(today, -1) }]
                )
              )
            }
          >
            Back today
          </button>
        </div>
      )}

      {coming.filter((e) => e !== off).length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {coming
            .filter((e) => e !== off)
            .map((e) => (
              <li key={`${e.kind}:${e.start}:${e.name}`} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: e.kind === "meet" ? "var(--color-protein)" : "var(--color-carbs)" }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {e.name}
                  <span className="text-[var(--color-mut)]">
                    {" "}
                    · {span(e)}
                    {e.kind === "meet" ? ` · ${TAPERS.find((t) => t.value === e.taper)?.label.toLowerCase()}` : ""}
                  </span>
                </span>
                <button
                  className="btn btn-sm btn-quiet hit shrink-0 px-2"
                  aria-label={`Remove ${e.name}`}
                  disabled={busy}
                  onClick={() => save(events.filter((x) => x !== e))}
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn btn-sm" onClick={() => setAdding("break")}>
          Time off
        </button>
        <button className="btn btn-sm" onClick={() => setAdding("meet")}>
          Add a meet
        </button>
      </div>

      {adding && (
        <EventSheet
          kind={adding}
          today={today}
          onClose={() => setAdding(null)}
          onAdd={async (e) => {
            await save([...events, e]);
            setAdding(null);
          }}
        />
      )}
    </>
  );
}

function EventSheet({
  kind,
  today,
  onClose,
  onAdd,
}: {
  kind: PlanEvent["kind"];
  today: string;
  onClose: () => void;
  onAdd: (e: PlanEvent) => Promise<void>;
}) {
  const meet = kind === "meet";
  const [name, setName] = useState(meet ? "" : "Time off");
  const [start, setStart] = useState(meet ? addDays(today, 14) : today);
  const [end, setEnd] = useState(meet ? addDays(today, 15) : addDays(today, 6));
  const [taper, setTaper] = useState<Taper>("partial");
  const [saving, setSaving] = useState(false);
  const ok = !!start && !!end && (!meet || name.trim().length > 0);

  return (
    <Sheet onClose={onClose} label={meet ? "Add a meet" : "Time off"}>
      <div className="shrink-0 px-5 pb-3 pt-2 sm:pt-5">
        <h2 className="text-lg font-bold tracking-tight">{meet ? "Add a meet" : "Time off"}</h2>
        <p className="mt-0.5 text-xs text-[var(--color-mut)]">
          {meet ? "Fuels the taper by how hard you're tapering." : "Rest-day food, and it picks up again after."}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
        {meet && (
          <div>
            <p className="label mb-1.5">Meet</p>
            <input
              className="field w-full"
              value={name}
              placeholder="Winter nationals"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        {!meet && (
          <div>
            <p className="label mb-1.5">How long</p>
            <div className="flex flex-wrap gap-1.5">
              {[2, 3, 7, 14].map((n) => (
                <button
                  key={n}
                  className={`btn btn-sm ${addDays(start, n - 1) === end ? "btn-accent" : ""}`}
                  onClick={() => setEnd(addDays(start, n - 1))}
                >
                  {n === 7 ? "A week" : n === 14 ? "Two weeks" : `${n} days`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label mb-1.5 block">{meet ? "First race day" : "From"}</span>
            <input
              type="date"
              className="field w-full"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                setStart(v);
                if (v && end < v) setEnd(v);
              }}
            />
          </label>
          <label className="block">
            <span className="label mb-1.5 block">{meet ? "Last race day" : "Back on"}</span>
            <input
              type="date"
              className="field w-full"
              value={meet ? end : addDays(end, 1)}
              min={meet ? start : addDays(start, 1)}
              onChange={(e) => e.target.value && setEnd(meet ? e.target.value : addDays(e.target.value, -1))}
            />
          </label>
        </div>

        {meet && (
          <div>
            <p className="label mb-1.5">Taper</p>
            <Segmented size="sm" value={taper} onChange={setTaper} options={TAPERS} />
            <p className="mt-1.5 text-xs text-[var(--color-mut)]">
              {TAPERS.find((t) => t.value === taper)?.hint}. Not sure? Partial.
            </p>
          </div>
        )}
      </div>

      <div className="safe-b flex shrink-0 gap-2 border-t border-[#1c1f25] px-5 pt-4">
        <button className="btn flex-1" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-accent flex-1"
          disabled={saving || !ok}
          onClick={async () => {
            setSaving(true);
            await onAdd({
              kind,
              name: name.trim() || (meet ? "Meet" : "Time off"),
              start,
              end: end < start ? start : end,
              ...(meet ? { taper } : {}),
            });
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
