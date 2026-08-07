import CollectionManager from "@/components/admin/collection-manager";
import { withSubtitle, type Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { newsletterPeriod } from "@/lib/format";

export const dynamic = "force-dynamic";

const FIELDS: Field[] = [
  { name: "title", label: "Issue title", type: "text", required: true,
    placeholder: "Summer round-up",
    help: "The headline for this issue. The months are shown separately, so you don't need them here." },
  { name: "period_start", label: "First month covered", type: "month", required: true, half: true },
  { name: "period_end", label: "Last month covered", type: "month", half: true,
    help: "Leave blank for a single-month issue. For a July/August issue, set this to August." },
  { name: "published", label: "Published", type: "boolean", defaultValue: true },
  { name: "summary", label: "What's in this issue", type: "textarea",
    placeholder: "Winter gala report, new J-Squad times, presentation evening date.",
    help: "One or two sentences. Shown on the newsletters page and the home page." },
  { name: "file_url", label: "Newsletter PDF", type: "file", folder: "newsletters",
    accept: ".pdf", sizeField: "file_size", required: true },
  { name: "cover_url", label: "Cover image", type: "file", folder: "newsletters",
    accept: "image/*", help: "Optional." },
];

export default async function AdminNewslettersPage() {
  const rows = await adminList("newsletters", { orderBy: "period_end", ascending: false });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl">Newsletters</h1>
        <p className="mt-1.5 text-ink-500">
          Upload the PDF and it appears immediately — the newest issue is featured on the
          newsletters page and the home page.
        </p>
      </div>

      <div className="card p-4 bg-brand-50 border-brand-200 text-[0.88rem] text-ink-700">
        <p className="font-semibold text-brand-900 mb-1">Issues covering two months</p>
        <p>
          For a July/August issue, set the first month to July and the last to August. It shows
          as <strong>&ldquo;July / August 2026&rdquo;</strong> and sorts as an August issue —
          so the archive never shows a gap for a July that never had its own newsletter.
        </p>
      </div>

      <CollectionManager
        table="newsletters"
        singular="Newsletter"
        fields={FIELDS}
        rows={withSubtitle(rows, (row) =>
          newsletterPeriod(
            row.period_start as string | null,
            row.period_end as string | null
          )
        )}
        titleField="title"
        emptyMessage="No newsletters uploaded yet."
      />
    </div>
  );
}
