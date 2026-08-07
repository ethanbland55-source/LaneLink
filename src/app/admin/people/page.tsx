import CollectionManager from "@/components/admin/collection-manager";
import { withSubtitle, type Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { PERSON_SECTIONS } from "@/lib/types";

export const dynamic = "force-dynamic";

const FIELDS: Field[] = [
  { name: "name", label: "Name", type: "text", required: true, half: true },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0,
    help: "Lower numbers appear first within their section." },
  { name: "sections", label: "Groups they're in", type: "tags",
    placeholder: PERSON_SECTIONS.map((s) => s.key).join("\n"),
    help: `One per line. Valid values: ${PERSON_SECTIONS.map((s) => s.key).join(", ")}. Add every group they belong to.` },
  { name: "primary_section", label: "Main group", type: "select", half: true,
    options: PERSON_SECTIONS.map((s) => ({ value: s.key, label: s.label })),
    help: "Where their full card appears. In their other groups they show as a small linked chip, so nobody's card is printed twice." },
  { name: "roles", label: "Roles", type: "tags",
    placeholder: "Committee Chair\nWelfare Officer",
    help: "One per line, most important first. Shown as badges on the card." },
  { name: "bio", label: "Short bio", type: "textarea",
    help: "Optional. One or two lines." },
  { name: "email", label: "Contact email", type: "email", half: true,
    help: "Optional. Only add it if they're happy to be contacted publicly." },
  { name: "phone", label: "Contact phone", type: "text", half: true,
    help: "Optional — usually only the Welfare Officer." },
  { name: "published", label: "Show on the site", type: "boolean", defaultValue: true },
  { name: "photo_url", label: "Photo", type: "file", folder: "people", accept: "image/*",
    help: "Optional — without one the card shows their initials on club colours. Square images work best." },
];

export default async function AdminPeoplePage() {
  const rows = await adminList("people", { orderBy: "sort_order" });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl">Who&rsquo;s Who</h1>
        <p className="mt-1.5 text-ink-500">
          Committee, coaches, team managers and officials — one entry per person, however many
          jobs they do.
        </p>
      </div>

      <div className="card p-4 bg-brand-50 border-brand-200 text-[0.88rem] text-ink-700">
        <p className="font-semibold text-brand-900 mb-1.5">Group keys</p>
        <ul className="space-y-0.5">
          {PERSON_SECTIONS.map((s) => (
            <li key={s.key}>
              <code className="text-brand-700">{s.key}</code> — {s.label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-ink-600">
          Someone who coaches <em>and</em> sits on the committee goes in both groups. Their full
          card shows under their main group; the other group lists them as a small chip that jumps
          to the card. That way the committee list is complete without the same photo appearing
          twice on the page.
        </p>
      </div>

      <CollectionManager
        table="people"
        singular="Person"
        fields={FIELDS}
        rows={withSubtitle(rows, (row) => {
          const roles = Array.isArray(row.roles) ? (row.roles as string[]) : [];
          const sections = Array.isArray(row.sections) ? (row.sections as string[]) : [];
          return [roles.join(" · "), sections.join(", ")].filter(Boolean).join(" — ");
        })}
        titleField="name"
        emptyMessage="Nobody added yet."
      />
    </div>
  );
}
