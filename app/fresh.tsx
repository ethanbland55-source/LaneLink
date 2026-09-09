"use client";

import { useEffect, useRef } from "react";

/**
 * Pick up a new deploy without being told to.
 *
 * A single-page app that has been open since before a deploy is running code
 * that no longer exists on the server. Mostly that shows up as the app being
 * subtly a version behind — old copy, old rules, an old idea of what the
 * database columns are. Occasionally it shows up as a blank screen, when a
 * lazily-loaded chunk 404s because its filename moved. Neither is something a
 * person can diagnose; both look like the app being broken.
 *
 * On a phone this is the normal case, not the edge case. The app gets added to
 * the home screen, opened, swiped away, and reopened days later — from the
 * back/forward cache, with the JavaScript exactly as it was.
 *
 * So: the bundle knows which build it came from, `/api/version` says which
 * build is being served now, and when they differ the page reloads.
 *
 * ## When it is safe to do that
 *
 * Reloading throws away anything typed and not saved, so the trigger matters
 * more than the check does:
 *
 *  - **Coming back to the tab** is the good moment, and the common one. You
 *    were away; you weren't mid-sentence. This is the case Ethan described —
 *    an old page sitting in the background that should be current by the time
 *    you look at it.
 *  - **While you are using it**, only when nothing is focused. A reload that
 *    lands while you are typing a gram amount is worse than being one version
 *    behind for another few minutes, and the next check comes round soon
 *    enough.
 *
 * The interval is slow on purpose. This is a correctness backstop, not
 * telemetry, and the visibility trigger does most of the work.
 *
 * ## Reloading at most once per build
 *
 * The check assumes that reloading fixes the mismatch. When that assumption is
 * wrong — the two ids are generated differently rather than the page being
 * genuinely old — reloading does not fix it, the fresh page checks again, and
 * the app spins forever at the speed of a page load. That is not a theoretical
 * failure; it is what `String(Date.now())` in next.config.ts did to every
 * local `next dev` and `next start` for weeks (see that file), and one absent
 * environment variable would have done the same to the live site.
 *
 * So the build we reloaded *for* is written down first, in sessionStorage —
 * per tab, cleared when the tab closes, which is exactly the scope of "have I
 * already tried this". If the same server build is still disagreeing after a
 * reload, the reload is not working and the honest thing is to stop and stay
 * on the old code. Being a version behind is a small problem. An app that
 * reloads forever is not a small problem, and it looks identical to the app
 * being down.
 */

/** How often to ask, while the tab is in front. */
const EVERY_MS = 5 * 60 * 1000;

/** The build this bundle was compiled from. */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Where the last attempt is remembered. Per tab, and gone when it closes. */
const TRIED_KEY = "mh:reloaded-for";

/**
 * Storage that cannot throw.
 *
 * Safari in private mode, and any browser set to block site data, raise on
 * access rather than returning null. A staleness check that crashes the app it
 * is meant to keep healthy would be a poor trade, so both directions swallow.
 * Failing to read means we might reload one extra time; failing to write means
 * the guard is off, which is where we started.
 */
function recall(): string | null {
  try {
    return sessionStorage.getItem(TRIED_KEY);
  } catch {
    return null;
  }
}

function remember(build: string): void {
  try {
    sessionStorage.setItem(TRIED_KEY, build);
  } catch {
    // No storage, no guard. Nothing to be done about it from here.
  }
}

export function Fresh() {
  const reloading = useRef(false);
  /**
   * We know there's a new build but haven't been able to act on it yet.
   *
   * Separating "is it stale" from "may I reload now" is what stops the one
   * bad case: come back to the tab with the cursor still sitting in a gram
   * box, and a check that reloads-or-forgets would forget, and then every
   * later check would find you still focused and forget again. Remembering it
   * means the reload happens the moment you tap away instead of never.
   */
  const stale = useRef(false);

  useEffect(() => {
    if (!MINE || MINE === "dev") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    /** The server build we most recently found ourselves behind. */
    let seen: string | null = null;

    /** True when a reload would cost someone something they typed. */
    function busy(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }

    function reloadIfAllowed() {
      if (!stale.current || reloading.current || busy()) return;
      // Already came back from a reload for this exact build and it is still
      // reporting a mismatch. Reloading did not help and will not help.
      if (seen && recall() === seen) return;
      reloading.current = true;
      if (seen) remember(seen);
      window.location.reload();
    }

    async function check() {
      if (reloading.current) return;
      if (stale.current) {
        reloadIfAllowed();
        return;
      }
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === MINE) return;
        seen = build;
        stale.current = true;
        reloadIfAllowed();
      } catch {
        // Offline, or the app is suspending mid-request. Being a version
        // behind is not worth an error message; the next check will do.
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") check();
    }

    /** Restored from the back/forward cache — the JS is as old as it gets. */
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) check();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    // The moment a field gives up focus is the moment a reload stops costing
    // anything, so it is the right time to cash in a deferred one.
    document.addEventListener("focusout", reloadIfAllowed);
    timer = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, EVERY_MS);

    check();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("focusout", reloadIfAllowed);
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
