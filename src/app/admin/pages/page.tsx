import CollectionManager from "@/components/admin/collection-manager";
import type { Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";

export const dynamic = "force-dynamic";

/** Slugs the site looks for. Anything else is simply unused. */
const KNOWN_SLUGS = [
  { slug: "about", where: "/about" },
  { slug: "policies", where: "/about/policies" },
  { slug: "team-protocol", where: "/competing/team-protocol" },
  { slug: "competition-faqs", where: "/competing/competition-faqs" },
  { slug: "join", where: "/join" },
  { slug: "privacy", where: "/privacy" },
];

const FIELDS: Field[] = [
  { name: "slug", label: "Page", type: "select", required: true, half: true,
    options: KNOWN_SLUGS.map((k) => ({ value: k.slug, label: `${k.slug} — ${k.where}` })) },
  { name: "published", label: "Published", type: "boolean", defaultValue: true, half: true },
  { name: "title", label: "Page heading", type: "text", required: true },
  { name: "intro", label: "Introduction", type: "textarea",
    help: "The single paragraph under the heading, in the purple band." },
  { name: "body", label: "Page content", type: "markdown",
    help: "Markdown: ## for a heading, **bold**, *italic*, - for bullets, 1. for numbers, [text](https://link)." },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
];

export default async function AdminPagesPage() {
  const rows = await adminList("pages", { orderBy: "sort_order" });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl">Page content</h1>
        <p className="mt-1.5 text-ink-500">
          The wordy pages. Anything you don't create here falls back to sensible built-in text, so
          the site never shows a blank page.
        </p>
      </div>

      <div className="card p-4 bg-brand-50 border-brand-200 text-[0.88rem] text-ink-700">
        <p className="font-semibold text-brand-900 mb-1.5">Which slug goes where</p>
        <ul className="space-y-0.5">
          {KNOWN_SLUGS.map((k) => (
            <li key={k.slug}>
              <code className="text-brand-700">{k.slug}</code> → {k.where}
            </li>
          ))}
        </ul>
      </div>

      <CollectionManager
        table="pages"
        singular="Page"
        fields={FIELDS}
        rows={rows}
        titleField="title"
        subtitle={(row) => String(row.slug ?? "")}
        emptyMessage="No pages overridden — every page is using its built-in text."
      />
    </div>
  );
}
