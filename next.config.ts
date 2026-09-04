import type { NextConfig } from "next";

/**
 * A stamp that changes on every deploy, readable from both sides.
 *
 * The commit sha where the host provides one, and the build clock otherwise.
 * The point is only that it differs between two builds — the client bakes it
 * into its bundle, `/api/version` reports whatever the *current* server is
 * running, and app/fresh.tsx reloads the page when they stop matching. See
 * that file for why a stale tab is worth this much trouble.
 *
 * `generateBuildId` is set from the same value so Next's own asset paths move
 * in step. Without that, two deploys could disagree about the app while
 * agreeing about the chunk filenames, which is the exact situation where a
 * stale page 404s on a lazy import instead of reloading.
 */
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT_SHA ??
  String(Date.now());

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  generateBuildId: async () => buildId,
};

export default nextConfig;
