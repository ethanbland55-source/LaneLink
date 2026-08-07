"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Keeps a failure in one admin screen from taking down the whole area, and
 * shows the error reference so a problem can actually be tracked down rather
 * than just being "something went wrong".
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl">
      <div className="card p-7 border-red-200">
        <p className="flex items-center gap-2.5 font-semibold text-red-900">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          This screen didn't load
        </p>
        <p className="mt-3 text-[0.94rem] text-ink-700">
          Everything else in the admin area still works — use the menu to carry on,
          or try this screen again.
        </p>
        <p className="mt-3 text-[0.88rem] text-ink-500">
          If it keeps happening, the most likely causes are the Supabase keys being
          missing or wrong in the environment variables, or the database schema not
          having been run.
        </p>
        {error.digest && (
          <p className="mt-3 text-[0.8rem] text-ink-400">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn btn-primary btn-sm">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </button>
          <Link href="/admin" className="btn btn-ghost btn-sm">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
