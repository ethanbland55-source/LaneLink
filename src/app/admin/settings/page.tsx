import CollectionManager from "@/components/admin/collection-manager";
import SettingsForm from "@/components/admin/settings-form";
import { withSubtitle, type Field } from "@/components/admin/fields";
import { adminList } from "@/lib/admin-queries";
import { getClubSettings } from "@/lib/queries";
import { DAY_NAMES } from "@/lib/format";
import type { Squad } from "@/lib/types";

export const dynamic = "force-dynamic";

const SQUAD_FIELDS: Field[] = [
  { name: "name", label: "Squad name", type: "text", required: true, half: true },
  { name: "slug", label: "Slug", type: "text", required: true, half: true,
    placeholder: "j-squad" },
  { name: "tagline", label: "One-line summary", type: "text", half: true,
    placeholder: "Junior competitive squad" },
  { name: "hours_guide", label: "Hours a week", type: "text", half: true, placeholder: "4-6 hrs" },
  { name: "description", label: "Description", type: "textarea" },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
  { name: "published", label: "Show on the site", type: "boolean", defaultValue: true, half: true },
];

const VENUE_FIELDS: Field[] = [
  { name: "name", label: "Venue name", type: "text", required: true, half: true },
  { name: "slug", label: "Slug", type: "text", required: true, half: true },
  { name: "address", label: "Address", type: "text" },
  { name: "postcode", label: "Postcode", type: "text", half: true },
  { name: "map_url", label: "Map link", type: "url", half: true },
  { name: "length_m", label: "Pool length (m)", type: "number", half: true },
  { name: "lanes", label: "Lanes", type: "number", half: true },
  { name: "notes", label: "Notes", type: "textarea" },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
];

const DOCUMENT_FIELDS: Field[] = [
  { name: "title", label: "Document title", type: "text", required: true },
  { name: "category", label: "Category", type: "text", half: true, defaultValue: "policies",
    placeholder: "policies", help: "Groups documents on the Policies page." },
  { name: "updated_on", label: "Last updated", type: "date", half: true },
  { name: "file_url", label: "File", type: "file", folder: "documents",
    accept: ".pdf,.docx", sizeField: "file_size", required: true },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
  { name: "published", label: "Published", type: "boolean", defaultValue: true, half: true },
];

const SPONSOR_FIELDS: Field[] = [
  { name: "name", label: "Name", type: "text", required: true, half: true },
  { name: "tier", label: "Type", type: "select", half: true, defaultValue: "supporter",
    options: [
      { value: "headline", label: "Headline sponsor" },
      { value: "supporter", label: "Supporter" },
      { value: "accreditation", label: "Accreditation badge" },
    ] },
  { name: "blurb", label: "Description", type: "textarea" },
  { name: "url", label: "Website", type: "url", half: true },
  { name: "logo_url", label: "Logo", type: "file", folder: "sponsors", accept: "image/*" },
  { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
  { name: "published", label: "Published", type: "boolean", defaultValue: true, half: true },
];

export default async function AdminSettingsPage() {
  const [club, squads, venues, documents, sponsors, sessions] = await Promise.all([
    getClubSettings(),
    adminList<Squad>("squads", { orderBy: "sort_order" }),
    adminList("venues", { orderBy: "sort_order" }),
    adminList("documents", { orderBy: "sort_order" }),
    adminList("sponsors", { orderBy: "sort_order" }),
    adminList("training_sessions", { orderBy: "day_of_week" }),
  ]);

  const sessionFields: Field[] = [
    { name: "squad_id", label: "Squad", type: "select", required: true, half: true,
      options: squads.map((s) => ({ value: s.id, label: s.name })) },
    { name: "day_of_week", label: "Day", type: "select", required: true, half: true,
      options: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: DAY_NAMES[d] })) },
    { name: "venue", label: "Venue", type: "text", required: true, half: true,
      placeholder: "Salt Ayre" },
    { name: "starts_at", label: "Starts", type: "time", required: true, half: true },
    { name: "ends_at", label: "Ends", type: "time", required: true, half: true },
    { name: "note", label: "Note", type: "text", half: true, placeholder: "Invite only" },
    { name: "sort_order", label: "Order", type: "number", half: true, defaultValue: 0 },
  ];

  const squadName = (id: unknown) => squads.find((s) => s.id === id)?.name ?? "Unassigned";

  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="text-2xl">Club settings</h1>
        <p className="mt-1.5 text-ink-500">
          The details that appear in the header, footer and across the site.
        </p>
      </div>

      <SettingsForm club={club} />

      <section>
        <h2 className="text-lg mb-2">Squads</h2>
        <p className="text-ink-500 text-[0.92rem] mb-4">
          The squads shown on the training page and the home page.
        </p>
        <CollectionManager
          table="squads"
          singular="Squad"
          fields={SQUAD_FIELDS}
          rows={withSubtitle(
            squads as unknown as Record<string, unknown>[],
            (row) => String(row.hours_guide ?? "")
          )}
          titleField="name"
        />
      </section>

      <section>
        <h2 className="text-lg mb-2">Training times</h2>
        <p className="text-ink-500 text-[0.92rem] mb-4">
          One entry per session. These build the timetable under each squad.
        </p>
        <CollectionManager
          table="training_sessions"
          singular="Session"
          fields={sessionFields}
          rows={withSubtitle(sessions, (row) =>
            `${squadName(row.squad_id)} · ${DAY_NAMES[Number(row.day_of_week)] ?? ""} ${row.starts_at}–${row.ends_at}`
          )}
          titleField="venue"
          emptyMessage="No training sessions added yet."
        />
      </section>

      <section>
        <h2 className="text-lg mb-2">Venues</h2>
        <CollectionManager
          table="venues"
          singular="Venue"
          fields={VENUE_FIELDS}
          rows={withSubtitle(venues, (row) => String(row.address ?? ""))}
          titleField="name"
        />
      </section>

      <section>
        <h2 className="text-lg mb-2">Club documents</h2>
        <p className="text-ink-500 text-[0.92rem] mb-4">
          Policies, safeguarding and anything else listed on the Policies page.
        </p>
        <CollectionManager
          table="documents"
          singular="Document"
          fields={DOCUMENT_FIELDS}
          rows={withSubtitle(documents, (row) => String(row.category ?? ""))}
          titleField="title"
        />
      </section>

      <section>
        <h2 className="text-lg mb-2">Supporters &amp; accreditations</h2>
        <CollectionManager
          table="sponsors"
          singular="Supporter"
          fields={SPONSOR_FIELDS}
          rows={withSubtitle(sponsors, (row) => String(row.tier ?? ""))}
          titleField="name"
        />
      </section>
    </div>
  );
}
