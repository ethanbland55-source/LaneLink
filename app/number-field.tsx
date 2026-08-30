"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number box you can actually clear.
 *
 * A controlled `<input type="number">` bound straight to a number is hostile to
 * type in: clearing it produces `Number("") === 0`, the 0 is written straight
 * back, and now you are typing *after* a zero. Hence 0100 for a hundred.
 *
 * So the box holds text while you are in it, and a number only when you leave.
 * Empty is a perfectly good thing to be mid-edit; on blur an empty box goes
 * back to what it was rather than committing a nought, because clearing a
 * field and tapping away is how someone changes their mind, not how they ask
 * for zero. Typing an actual 0 still commits 0.
 *
 * `allowEmpty` is for the boxes where blank genuinely means something — a
 * share you have not set, a limit you want the app to choose — and there the
 * empty state commits as null instead of reverting.
 */
export function NumberField({
  value,
  onCommit,
  allowEmpty = false,
  placeholder,
  className = "",
  ...rest
}: {
  value: number | null | undefined;
  onCommit: (v: number | null) => void;
  /** Blank commits null rather than reverting. */
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "className"
>) {
  const [text, setText] = useState<string>(value == null ? "" : String(value));
  const [editing, setEditing] = useState(false);

  // While you're not in the box, it shows whatever the plan says — which
  // matters here because the fit rewrites these numbers as you change others.
  useEffect(() => {
    if (!editing) setText(value == null ? "" : String(value));
  }, [value, editing]);

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      className={`field ${className}`}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setEditing(true);
        // Tapping a box that sits under the keyboard is the commonest thing
        // there is; bring it into view once the viewport has settled.
        scrollIntoViewSoon(e.currentTarget);
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        // Commit as you type when it's a real number, so the preview keeps up.
        if (e.target.value !== "" && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={(e) => {
        setEditing(false);
        const raw = e.target.value.trim();
        if (raw === "") {
          if (allowEmpty) onCommit(null);
          else setText(value == null ? "" : String(value)); // put it back
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onCommit(n);
        else setText(value == null ? "" : String(value));
        rest.onBlur?.(e);
      }}
    />
  );
}

/**
 * Bring a focused field into view once the keyboard has finished animating.
 *
 * Two frames is not enough on iOS — the visual viewport resizes over roughly a
 * quarter of a second, and scrolling before it settles scrolls to where the
 * field *was*. Doing it twice covers both the fast case and the slow one.
 */
export function scrollIntoViewSoon(el: HTMLElement) {
  const go = () => el.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(go, 80);
  setTimeout(go, 350);
}

/** The same idea for a `<select>`, which has the same problem on a phone. */
export function useKeyboardSafeFocus() {
  const ref = useRef<HTMLElement | null>(null);
  return {
    ref,
    onFocus: () => {
      if (ref.current) scrollIntoViewSoon(ref.current);
    },
  };
}
