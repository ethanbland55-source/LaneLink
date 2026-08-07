import CollectionManager from "@/components/admin/collection-manager";
import type { Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { PERSON_SECTIONS } from "@/lib/types";

export const dynamic = "force-dynamic";

const FIELDS: Field[] = [
  { name: "name", label: "Name", type: "text", required: true, half: true },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0,
    help: "Lower numbers appear first within their section." },
  { name: "sections", label: "Sections", type: "tags",
    placeholder: PERSON_SECTIONS.map((s) => s.key).join("\n"),
    help: `One per line. Valid values: ${PERSON_SECTIONS.map((s) => s.key).join(", ")}. Somebody can appear in more than one.` },
  { name: "roles", label: "Roles", type: "tags",
    placeholder: "Committee Chair\nWelfare Officer",
    help: "One per line, most important first. Shown as badges on the card." },
  { name: "bio", label: "Short bio", type: "textarea",
    help: "Optional. One or two lines." },
  { name: "email", label: "Contact email", type: "email", half: true,
    help: "Optional. Only add it if they're happy to be contacted publicly." },
  { name: "published", label: "Show on the site", type: "boolean", defaultValue: true, half: true },
  { name: "photo_url", label: "Photo", type: "file", folder: "people", accept: "image/*",
    help: "Optional — without one the card shows their initials on club colours. Square images work best." },
];

export default async function AdminPeoplePage() {
  const rows = await adminList("people", { orderBy: "sort_order" });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl">Who's Who</h1>
        <p className="mt-1.5 text-ink-500">
          Committee, coaches, team managers and officials. Somebody who does two jobs can be listed
          in both sections from a single entry.
        </p>
      </div>

      <div className="card p-4 bg-brand-50 border-brand-200 text-[0.88rem] text-ink-700">
        <p className="font-semibold text-brand-900 mb-1.5">Section keys</p>
        <ul className="space-y-0.5">
          {PERSON_SECTIONS.map((s) => (
            <li key={s.key}>
              <code className="text-brand-700">{s.key}</code> — {s.label}
            </li>
          ))}
        </ul>
      </div>

      <CollectionManager
        table="people"
        singular="Person"
        fields={FIELDS}
        rows={rows}
        titleField="name"
        subtitle={(row) => {
          const roles = Array.isArray(row.roles) ? (row.roles as string[]) : [];
          const sections = Array.isArray(row.sections) ? (row.sections as string[]) : [];
          return [roles.join(" · "), sections.join(", ")].filter(Boolean).join(" — ");
        }}
        emptyMessage="Nobody added yet."
      />
    </div>
  );
}
