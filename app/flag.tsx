"use client";

import type { ReactNode } from "react";

/**
 * One shape for everything that needs your attention.
 *
 * There were six of these and no two looked alike: filled amber slabs on some
 * cards, bare orange sentences on others, a pink line on the sign-in page. A
 * warning that looks different every time it appears is a warning you have to
 * read to find out how much it matters, which is exactly backwards — the whole
 * job of the styling is to tell you that before you read a word.
 *
 * So: one component, three tones, and a hard rule about length. The headline
 * is the fact, in a handful of words, and it is the only part guaranteed to be
 * read. Anything that explains, justifies or cites goes in `children`, behind
 * the same question mark the rest of the app uses. If you find yourself
 * writing a third sentence, it belongs in a Note.
 *
 * The old blocks were a solid amber fill, which shouts the same volume whether
 * the news is "this is 13 g off" or "your fat is under the floor". A quiet
 * ground with a coloured edge carries the same information and lets six of
 * them share a screen without it looking like a fault report.
 */

export type Tone = "warn" | "bad" | "info";

const TONE: Record<Tone, string> = {
  warn: "var(--color-carbs)",
  bad: "var(--color-fat)",
  info: "var(--color-mut)",
};

export function Flag({
  tone = "warn",
  title,
  detail,
  action,
  children,
  className = "",
}: {
  tone?: Tone;
  /** The fact. A handful of words — this is the part that gets read. */
  title: ReactNode;
  /** One line of context at most. Anything longer belongs in `children`. */
  detail?: ReactNode;
  /** A button that fixes it, where there is one. */
  action?: ReactNode;
  /** The explaining, behind a disclosure. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flag ${className}`} style={{ ["--flag" as string]: TONE[tone] }}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold" style={{ color: TONE[tone] }}>
          {title}
        </p>
        {detail && <p className="mt-0.5 text-xs text-[var(--color-mut)]">{detail}</p>}
        {children}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}
