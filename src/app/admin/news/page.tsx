import CollectionManager from "@/components/admin/collection-manager";
import type { Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const FIELDS: Field[] = [
  { name: "title", label: "Headline", type: "text", required: true },
  { name: "slug", label: "URL slug", type: "text", required: true, half: true,
    placeholder: "winter-gala-report-2026",
    help: "Lowercase with hyphens. This becomes /news/your-slug." },
  { name: "published_at", label: "Date", type: "date", half: true },
  { name: "excerpt", label: "Summary", type: "textarea",
    help: "One or two sentences, shown on the news list and home page." },
  { name: "body", label: "Article", type: "markdown",
    help: "Markdown: ## for a heading, **bold**, - for bullets, [text](https://link)." },
  { name: "image_url", label: "Header image", type: "file", folder: "news", accept: "image/*" },
  { name: "published", label: "Published", type: "boolean", defaultValue: true },
];

export default async function AdminNewsPage() {
  const rows = await adminList("news", { orderBy: "published_at", ascending: false });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl">News posts</h1>
        <p className="mt-1.5 text-ink-500">
          Gala reports, announcements and anything worth a page of its own.
        </p>
      </div>

      <CollectionManager
        table="news"
        singular="Post"
        fields={FIELDS}
        rows={rows}
        titleField="title"
        subtitle={(row) => formatDate(String(row.published_at ?? ""))}
        emptyMessage="No posts yet."
      />
    </div>
  );
}
