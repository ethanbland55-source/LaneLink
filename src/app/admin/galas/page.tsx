import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import CollectionManager from "@/components/admin/collection-manager";
import { withSubtitle, type Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { formatDateRange } from "@/lib/format";
import type { Gala, GalaSeries } from "@/lib/types";

export const dynamic = "force-dynamic";

const SERIES_FIELDS: Field[] = [
  { name: "name", label: "Series name", type: "text", required: true, half: true,
    placeholder: "Winter Gala", help: "The recurring competition, e.g. Winter Gala." },
  { name: "slug", label: "URL slug", type: "text", required: true, half: true,
    placeholder: "winter-gala", help: "Lowercase, hyphens only. Used in the web address." },
  { name: "blurb", label: "Description", type: "textarea",
    placeholder: "Our short-course winter meet at Salt Ayre." },
  { name: "accent", label: "Accent colour", type: "select", half: true,
    options: [
      { value: "purple", label: "Purple" },
      { value: "gold", label: "Gold" },
      { value: "teal", label: "Teal" },
    ], defaultValue: "purple" },
  { name: "sort_order", label: "Sort order", type: "number", half: true, defaultValue: 0 },
  { name: "published", label: "Show on the site", type: "boolean", defaultValue: true },
];

export default async function AdminGalasPage() {
  const [galas, series] = await Promise.all([
    adminList<Gala>("galas", { orderBy: "start_date", ascending: false }),
    adminList<GalaSeries>("gala_series", { orderBy: "sort_order" }),
  ]);

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl">Galas &amp; results</h1>
        <p className="mt-1.5 text-ink-500">
          Each gala keeps its own permanent page. Adding this year's Summer Gala never touches
          last year's Winter Gala.
        </p>
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg">All galas</h2>
          <Link href="/admin/galas/new" className="btn btn-primary btn-sm">
            <Plus className="h-4 w-4" aria-hidden />
            New gala
          </Link>
        </div>

        {galas.length === 0 ? (
          <div className="card p-8 text-center text-ink-500">
            No galas yet. Create a series below first, then add your first gala.
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
                      {gala.is_live && <span className="ml-2 badge badge-live">Live</span>}
                    </span>
                    <span className="block text-[0.82rem] text-ink-500">
                      {[
                        formatDateRange(gala.start_date, gala.end_date),
                        gala.venue,
                        gala.imported_at ? "results imported" : "no results",
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-ink-400 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg mb-2">Gala series</h2>
        <p className="text-ink-500 text-[0.92rem] mb-4">
          Series group the editions together — "Winter Gala" holds 2025, 2026, 2027 and so on, each
          with its own archived results page.
        </p>
        <CollectionManager
          table="gala_series"
          singular="Series"
          fields={SERIES_FIELDS}
          rows={withSubtitle(
            series as unknown as Record<string, unknown>[],
            (row) => `/results/series/${String(row.slug ?? "")}`
          )}
          titleField="name"
          emptyMessage="No series yet — add Winter Gala, Summer Gala and any others you run."
        />
      </section>
    </div>
  );
}
