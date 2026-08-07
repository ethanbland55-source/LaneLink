import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import CollectionManager from "@/components/admin/collection-manager";
import GalaDayPanel from "@/components/admin/gala-day-panel";
import GalaEditor from "@/components/admin/gala-editor";
import LenexImport from "@/components/admin/lenex-import";
import { withSubtitle, type Field } from "@/components/admin/fields";
import { adminList, adminOne } from "@/lib/admin-queries";
import { FILE_GROUPS, type Gala, type GalaSeries, type GalaSession } from "@/lib/types";
import { formatWeekday } from "@/lib/format";

export const dynamic = "force-dynamic";

const FILE_FIELDS: Field[] = [
  { name: "label", label: "What is it?", type: "text", required: true, half: true,
    placeholder: "Meet conditions" },
  { name: "group_key", label: "Section", type: "select", required: true, half: true,
    options: FILE_GROUPS.map((g) => ({ value: g.key, label: g.label })),
    defaultValue: "conditions" },
  { name: "file_url", label: "File", type: "file", folder: "galas",
    accept: ".pdf,.csv,.xlsx,.docx", sizeField: "file_size",
    help: "PDFs work best. Uploads go straight to storage — no size limit worries under 25 MB." },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
];

const SESSION_FIELDS: Field[] = [
  { name: "number", label: "Session number", type: "number", required: true, half: true },
  { name: "name", label: "Name", type: "text", half: true, placeholder: "Saturday morning" },
  { name: "session_date", label: "Date", type: "date", half: true },
  { name: "warmup_time", label: "Warm-up", type: "time", half: true },
  { name: "start_time", label: "Start", type: "time", half: true },
  { name: "start_list_url", label: "Start lists PDF", type: "file", folder: "galas", accept: ".pdf" },
  { name: "results_url", label: "Results PDF", type: "file", folder: "galas", accept: ".pdf" },
];

export default async function AdminGalaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isNew = id === "new";

  const series = await adminList<GalaSeries>("gala_series", { orderBy: "sort_order" });

  if (isNew) {
    return (
      <div className="max-w-4xl space-y-6">
        <BackLink />
        <h1 className="text-2xl">New gala</h1>
        {series.length === 0 && (
          <p className="card p-4 text-[0.92rem] bg-amber-50 border-amber-300 text-amber-900">
            You haven't created any series yet. You can still add the gala, but assigning it to a
            series (Winter Gala, Summer Gala…) is what keeps the archives separated.
          </p>
        )}
        <GalaEditor gala={null} series={series} />
      </div>
    );
  }

  const gala = await adminOne<Gala>("galas", id);
  if (!gala) notFound();

  const [files, sessions] = await Promise.all([
    adminList("gala_files", { eq: ["gala_id", id], orderBy: "sort_order" }),
    adminList<GalaSession>("gala_sessions", { eq: ["gala_id", id], orderBy: "number" }),
  ]);

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <BackLink />
        <h1 className="text-2xl mt-3">{gala.name}</h1>
        <p className="mt-1.5 text-ink-500">
          Permanent address: <code className="text-brand-700">/results/{gala.slug}</code>
        </p>
      </div>

      <GalaEditor gala={gala as unknown as Record<string, unknown>} series={series} />

      <GalaDayPanel
        galaId={gala.id}
        token={gala.ingest_token}
        lastFileAt={gala.last_file_at}
        liveUpdatedAt={gala.live_updated_at}
      />

      <LenexImport galaId={gala.id} galaName={gala.name} importedAt={gala.imported_at} />

      <section>
        <h2 className="text-lg mb-2">Sessions</h2>
        <p className="text-ink-500 text-[0.92rem] mb-4">
          Importing a Lenex file creates these automatically. Add them by hand only if you're
          publishing PDFs without a Lenex export.
        </p>
        <CollectionManager
          table="gala_sessions"
          singular="Session"
          fields={SESSION_FIELDS}
          rows={withSubtitle(
            sessions as unknown as Record<string, unknown>[],
            (row) =>
              [
                row.name ? String(row.name) : null,
                row.session_date ? formatWeekday(String(row.session_date)) : null,
                row.start_time ? `starts ${row.start_time}` : null,
              ].filter(Boolean).join(" · ")
          )}
          titleField="number"
          fixed={{ gala_id: gala.id }}
          emptyMessage="No sessions yet — import a Lenex file, or add them here to attach PDFs."
        />
      </section>

      <section>
        <h2 className="text-lg mb-2">Downloads</h2>
        <p className="text-ink-500 text-[0.92rem] mb-4">
          Meet conditions, programme, accepted entries, warm-up times — anything people need to
          download. These appear under the Downloads tab on the gala page.
        </p>
        <CollectionManager
          table="gala_files"
          singular="File"
          fields={FILE_FIELDS}
          rows={withSubtitle(
            files as unknown as Record<string, unknown>[],
            (row) =>
              FILE_GROUPS.find((g) => g.key === row.group_key)?.label ??
              String(row.group_key ?? "")
          )}
          titleField="label"
          fixed={{ gala_id: gala.id }}
          emptyMessage="No files uploaded for this gala yet."
        />
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/galas"
      className="inline-flex items-center gap-2 text-[0.9rem] text-ink-500 hover:text-brand-700"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All galas
    </Link>
  );
}
