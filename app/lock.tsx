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
 * instant you look away means glancing at a notification costs you a
 * sign-in. Set `NEXT_PUBLIC_LOCK_AFTER=0` to remove it.
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

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const since = hiddenAt.current;
      hiddenAt.current = null;
      if (since != null && Date.now() - since >= LOCK_AFTER_SECONDS * 1000) lock();
    }

    /** Restored from the back/forward cache — treat it as a fresh open. */
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) lock();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, path]);

  return null;
}
