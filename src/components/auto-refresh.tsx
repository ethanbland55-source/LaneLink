"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Quietly re-fetches the page on an interval so the live results page keeps up
 * during a gala without anyone hitting reload. Pauses while the tab is hidden
 * so it doesn't burn a phone battery in someone's pocket poolside.
 */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [countdown, setCountdown] = useState(seconds);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused) return;
    const tick = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          router.refresh();
          return seconds;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [paused, router, seconds]);

  return (
    <div className="flex items-center gap-2.5 text-[0.82rem] text-ink-500">
      <RefreshCw
        className={`h-3.5 w-3.5 ${paused ? "" : "animate-spin [animation-duration:3s]"}`}
        aria-hidden
      />
      <span aria-live="polite">
        {paused ? "Paused — tab in background" : `Updating in ${countdown}s`}
      </span>
      <button
        type="button"
        onClick={() => { router.refresh(); setCountdown(seconds); }}
        className="underline underline-offset-2 hover:text-brand-700"
      >
        Refresh now
      </button>
    </div>
  );
}
