import Link from "next/link";
import { AlertTriangle, ArrowRight, FileText, Newspaper, Trophy, Users } from "lucide-react";
import { adminCount, adminList } from "@/lib/admin-queries";
import { supabaseAdminConfigured } from "@/lib/supabase";
import { formatDateRange, galaStatus } from "@/lib/format";
import type { Gala } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  if (!supabaseAdminConfigured) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl mb-5">Dashboard</h1>
        <div className="card p-6 border-amber-300 bg-amber-50">
          <p className="flex items-start gap-2.5 font-semibold text-amber-900">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" aria-hidden />
            Supabase isn't connected yet
          </p>
          <p className="mt-3 text-[0.94rem] text-amber-900/85">
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> to your environment variables and redeploy. Until
            then the site renders with empty states and nothing can be saved.
          </p>
          <p className="mt-3 text-[0.94rem] text-amber-900/85">
            The database tables themselves are created by running{" "}
            <code>supabase/schema.sql</code> in the Supabase SQL editor.
          </p>
        </div>
      </div>
    );
  }

  const [galas, galaCount, newsletterCount, peopleCount, newsCount] = await Promise.all([
    adminList<Gala>("galas", { orderBy: "start_date", ascending: false, limit: 6 }),
    adminCount("galas"),
    adminCount("newsletters"),
    adminCount("people"),
    adminCount("news"),
  ]);

  const liveGala = galas.find((g) => galaStatus(g) === "live");

  const cards = [
    { href: "/admin/galas", label: "Galas", count: galaCount, Icon: Trophy },
    { href: "/admin/newsletters", label: "Newsletters", count: newsletterCount, Icon: FileText },
    { href: "/admin/people", label: "Who's Who", count: peopleCount, Icon: Users },
    { href: "/admin/news", label: "News posts", count: newsCount, Icon: Newspaper },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl">Dashboard</h1>
        <p className="mt-1.5 text-ink-500">Everything that keeps the site up to date.</p>
      </div>

      {liveGala && (
        <div className="card p-6 bg-aqua-100 border-aqua-400">
          <p className="badge badge-live mb-3">
            <span className="live-dot" aria-hidden />
            Live now
          </p>
          <h2 className="text-xl">{liveGala.name}</h2>
          <p className="mt-1.5 text-ink-600 text-[0.92rem]">
            {formatDateRange(liveGala.start_date, liveGala.end_date)}
          </p>
          <Link href={`/admin/galas/${liveGala.id}`} className="btn btn-brand btn-sm mt-4">
            Publish results
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ href, label, count, Icon }) => (
          <Link key={href} href={href} className="card card-hover p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3.5 text-2xl font-[family-name:var(--font-heading)] font-bold text-brand-900 tnum">
              {count}
            </p>
            <p className="text-[0.88rem] text-ink-500">{label}</p>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="text-lg mb-3">Recent galas</h2>
        {galas.length === 0 ? (
          <div className="card p-6 text-ink-500">
            No galas yet.{" "}
            <Link href="/admin/galas" className="text-brand-600 underline underline-offset-2">
              Add the first one
            </Link>
            .
          </div>
        ) : (
          <ul className="card divide-y divide-ink-100">
            {galas.map((gala) => (
              <li key={gala.id}>
                <Link
                  href={`/admin/galas/${gala.id}`}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-brand-50 transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-brand-900 truncate">
                      {gala.name}
                      {!gala.published && <span className="ml-2 badge badge-muted">Draft</span>}
                    </span>
                    <span className="block text-[0.82rem] text-ink-500">
                      {formatDateRange(gala.start_date, gala.end_date)}
                      {gala.imported_at ? " · results imported" : " · no results yet"}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-ink-400 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-6 bg-brand-50 border-brand-200">
        <h2 className="text-lg">Publishing results on gala day</h2>
        <ol className="mt-3 space-y-2 text-[0.94rem] text-ink-700 list-decimal pl-5">
          <li>Create the gala (or open this year's) and tick <strong>Published</strong>.</li>
          <li>In Meet Organisation: <strong>File → Export → Lenex</strong>.</li>
          <li>Upload that file on the gala's page. Sessions, events, results and splits all load in one go.</li>
          <li>Re-upload any time — the import replaces this gala's results only, never another gala's.</li>
        </ol>
      </div>
    </div>
  );
}
