import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * A stamp that changes on every deploy, readable from both sides — and, the
 * part that matters, *the same value in every process that asks*.
 *
 * The client bakes this into its bundle at compile time, `/api/version`
 * reports whatever the current server holds, and app/fresh.tsx reloads the
 * page when the two stop matching. See that file for why a stale tab is worth
 * this much trouble.
 *
 * It used to fall back to `String(Date.now())`, and that was a trap with teeth.
 * Next evaluates this file in more than one process — the config load, the
 * build workers, the server — and each one called `Date.now()` again. A single
 * `next build` produced three different ids: one in `.next/BUILD_ID`, another
 * baked into the client chunks, a third served by the API route. The client
 * could therefore never agree with the server, fresh.tsx correctly concluded
 * the page was stale, reloaded, checked again on the way up, disagreed again,
 * and reloaded again — an infinite loop at the speed of a page load, for as
 * long as the tab was open.
 *
 * It never showed up in production because Vercel sets VERCEL_GIT_COMMIT_SHA
 * in every process, so all three agreed there. It broke `next dev` and
 * `next start` every single time, which is where it was finally seen.
 *
 * So the fallback is now the commit sha read from git, which is the same
 * answer whoever asks and however often. If even that is unavailable the id
 * becomes "dev", which fresh.tsx treats as "don't check" — a staleness check
 * that cannot work should switch itself off rather than guess, and a wrong
 * guess here costs the whole app.
 *
 * `generateBuildId` is set from the same value so Next's own asset paths move
 * in step. Without that, two deploys could disagree about the app while
 * agreeing about the chunk filenames, which is the exact situation where a
 * stale page 404s on a lazy import instead of reloading.
 */
function commitSha(): string | null {
  try {
    const sha = execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT_SHA ??
  commitSha() ??
  "dev";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  generateBuildId: async () => buildId,
};

export default nextConfig;
