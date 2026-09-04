"use client";

import { useState, type ReactNode } from "react";

/**
 * The explanations, out of the way.
 *
 * Most of what this app knows is worth knowing once. Why 30 kcal per kg of
 * lean mass is the floor, why carbohydrate scales with training rather than
 * with calories, why a cooked batch can be served lighter but not re-mixed —
 * you read it, you get it, and from then on it is a paragraph standing between
 * you and the number you opened the app for.
 *
 * Leaving it on screen forever is the mistake. Every card grew a paragraph,
 * every paragraph pushed the figures further down, and a plan you check on a
 * phone at six in the morning turned into an essay you scroll past. The
 * knowledge is not the problem; the shouting is.
 *
 * So it goes behind a question mark. One tap, same words, and the screen goes
 * back to being numbers when you're done. Nothing is deleted and nothing is
 * hidden — it is simply not the first thing you see.
 */

/** The mark itself, as a span, so it can sit inside a button of its own. */
function Mark({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-[1.15rem] w-[1.15rem] shrink-0 items-center justify-center rounded-full border text-[0.66rem] font-bold leading-none transition-colors"
      style={{
        borderColor: open ? "var(--color-accent)" : "#2f3540",
        color: open ? "var(--color-accent)" : "#5b6270",
      }}
    >
      ?
    </span>
  );
}

/**
 * A section heading with its explanation folded into it.
 *
 * `right` is for whatever the heading already carried on the other side — a
 * total, a count, a button — so adopting this never costs a layout.
 */
export function SectionLabel({
  title,
  info,
  right,
}: {
  title: string;
  info?: ReactNode;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2">
        <p className="label">{title}</p>
        {info && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide the explanation" : "What is this?"}
            className="inline-flex"
          >
            <Mark open={open} />
          </button>
        )}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {info && open && (
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-mut)]">{info}</p>
      )}
    </>
  );
}

/**
 * The same thing without a heading, for an explanation that belongs to a row
 * or a card rather than to a whole section.
 */
export function Note({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1.5 inline-flex items-center gap-1.5 text-[0.7rem] text-[#5b6270]"
      >
        <Mark open={open} />
        {label ?? "Why"}
      </button>
      {open && (
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[var(--color-mut)]">{children}</p>
      )}
    </>
  );
}
