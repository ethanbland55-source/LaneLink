import CollectionManager from "@/components/admin/collection-manager";
import type { Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const FIELDS: Field[] = [
  { name: "title", label: "Issue title", type: "text", required: true,
    placeholder: "April / May 2026" },
  { name: "issue_date", label: "Issue date", type: "date", required: true, half: true,
    help: "Used to order the archive. The first of the month is fine." },
  { name: "published", label: "Published", type: "boolean", defaultValue: true, half: true },
  { name: "summary", label: "What's in this issue", type: "textarea",
    placeholder: "Winter gala report, new J-Squad times, presentation evening date.",
    help: "One or two sentences. Shown on the newsletters page and the home page." },
  { name: "file_url", label: "Newsletter PDF", type: "file", folder: "newsletters",
    accept: ".pdf", sizeField: "file_size", required: true },
  { name: "cover_url", label: "Cover image", type: "file", folder: "newsletters",
    accept: "image/*", help: "Optional." },
];

export default async function AdminNewslettersPage() {
  const rows = await adminList("newsletters", { orderBy: "issue_date", ascending: false });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl">Newsletters</h1>
        <p className="mt-1.5 text-ink-500">
          Upload the PDF and it appears on the newsletters page immediately — the newest issue is
          also featured on the home page.
        </p>
      </div>

      <CollectionManager
        table="newsletters"
        singular="Newsletter"
        fields={FIELDS}
        rows={rows}
        titleField="title"
        subtitle={(row) => formatDate(String(row.issue_date ?? ""))}
        emptyMessage="No newsletters uploaded yet."
      />
    </div>
  );
}
