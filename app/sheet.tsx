"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A bottom sheet that behaves itself on a phone.
 *
 * A `position: fixed` overlay with a scrolling area inside it is where iOS
 * Safari does its worst, and every one of these is a thing that actually goes
 * wrong rather than a precaution:
 *
 *  - **The page scrolls behind it.** Drag anywhere that isn't the scroll area
 *    — the header, the backdrop, the footer — and Safari scrolls the document
 *    underneath. Reach the end of the inner scroll and keep going and it does
 *    the same. `overscroll-behavior` fixes the second; only pinning the body
 *    fixes the first.
 *  - **Closing loses your place.** Pinning the body means remembering the
 *    scroll position and putting it back, or the page jumps to the top when
 *    the sheet closes.
 *  - **The keyboard hides the field you're typing in.** `dvh` accounts for the
 *    browser chrome and not for the keyboard, so a fixed sheet stays full
 *    height and the input you tapped ends up underneath it. The visual
 *    viewport is the only thing that knows, so the sheet is sized from that.
 *  - **It doesn't move like a sheet.** On a phone this shape is expected to
 *    follow your thumb and to close when you flick it down. One that ignores
 *    you feels broken even when nothing is.
 */
export function Sheet({
  onClose,
  children,
  label,
}: {
  onClose: () => void;
  children: React.ReactNode;
  label: string;
}) {
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  const startY = useRef<number | null>(null);
  const [view, setView] = useState<{ height: number; top: number } | null>(null);

  /* --- pin the page underneath ------------------------------------------ */
  useEffect(() => {
    const y = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      // Put them back where they were, or closing throws them to the top.
      window.scrollTo(0, y);
    };
  }, []);

  /* --- follow the visual viewport, which is what the keyboard moves ------ */
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => setView({ height: v.height, top: v.offsetTop });
    update();
    v.addEventListener("resize", update);
    v.addEventListener("scroll", update);
    return () => {
      v.removeEventListener("resize", update);
      v.removeEventListener("scroll", update);
    };
  }, []);

  /* --- escape closes it ------------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* --- drag the grip to dismiss ----------------------------------------- */
  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY;
    setSettling(false);
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    // Downward only. Dragging up on a sheet that is already at its full height
    // should do nothing rather than stretch it.
    setDrag(dy > 0 ? dy : 0);
  }
  function onTouchEnd() {
    startY.current = null;
    setSettling(true);
    // Far enough to read as intent rather than a slip.
    if (drag > 110) onClose();
    else setDrag(0);
  }

  return (
    <div
      className="fixed inset-x-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      style={{
        top: view ? view.top : 0,
        height: view ? view.height : "100dvh",
      }}
    >
      {/* Backdrop. Tapping it closes, which on a phone is the way out people
          reach for before they look for the ✕. */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="card relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-b-none sm:rounded-b-[1.25rem]"
        style={{
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: settling ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        {/* The grip. Also the drag handle, so the gesture has something to
            aim at and can't be confused with scrolling the content. */}
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 sm:hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <span className="h-1 w-9 rounded-full bg-[#3a4048]" />
        </div>

        {children}
      </div>
    </div>
  );
}
