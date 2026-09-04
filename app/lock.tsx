"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LOCK_AFTER_SECONDS } from "@/lib/auth";

/**
 * Re-lock when you come back to it.
 *
 * A session cookie covers the app genuinely being closed, but a home-screen
 * app on iOS is usually *suspended*, not closed — swipe away, come back
 * tomorrow, and the browser considers it the same session. So the client
 * watches for the app being backgrounded and signs out on the way back in.
 *
 * The grace period exists because the alternative is worse: locking the
 * instant you look away means checking a message costs you a sign-in, and a
 * lock people resent is a lock people turn off. Ten minutes by default — see
 * LOCK_AFTER_SECONDS. Set `NEXT_PUBLIC_LOCK_AFTER=0` to remove it.
 *
 * It signs out server-side rather than just navigating to `/login`, because a
 * redirect you can press Back on isn't a lock.
 */
export function Lock() {
  const router = useRouter();
  const path = usePathname();
  const hiddenAt = useRef<number | null>(null);
  const locking = useRef(false);

  useEffect(() => {
    if (path === "/login") return;

    async function lock() {
      if (locking.current) return;
      locking.current = true;
      try {
        await fetch("/api/auth", { method: "DELETE" });
      } catch {
        // Offline, or the request was cut off by the app suspending. Go to the
        // sign-in page anyway — the middleware is the thing that actually
        // enforces this, and it will ask again on the next request.
      }
      router.replace("/login");
    }

    /** Lock only if we have actually been away longer than the grace period. */
    function lockIfStale() {
      const since = hiddenAt.current;
      hiddenAt.current = null;
      if (since == null) return;
      if (Date.now() - since >= LOCK_AFTER_SECONDS * 1000) lock();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      lockIfStale();
    }

    /**
     * Going into the back/forward cache is a kind of hidden the visibility
     * event doesn't always cover, so stamp the clock here too.
     */
    function onPageHide() {
      if (hiddenAt.current == null) hiddenAt.current = Date.now();
    }

    /**
     * Restored from the back/forward cache.
     *
     * This used to lock outright, which was defensible at a fifteen-second
     * grace and is not at ten minutes — pressing Back would sign you out
     * however briefly you had been gone, and the setting would be a fiction.
     * So it takes the same reading as everything else: how long were we away.
     * The `pagehide` stamp above is what makes that answerable.
     */
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) lockIfStale();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, path]);

  return null;
}
