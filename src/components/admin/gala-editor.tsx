"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, LoaderCircle, Trash2 } from "lucide-react";
import { FieldInput } from "./collection-manager";
import type { Field, Row } from "./fields";
import { slugify } from "@/lib/format";
import type { GalaSeries } from "@/lib/types";

export default function GalaEditor({
  gala,
  series,
}: {
  gala: Row | null;
  series: GalaSeries[];
}) {
  const router = useRouter();
  const isNew = !gala?.id;
  const thisYear = new Date().getFullYear();

  const [values, setValues] = useState<Row>(
    gala ?? {
      name: "",
      slug: "",
      series_id: "",
      edition_year: thisYear,
      start_date: "",
      end_date: "",
      venue: "Salt Ayre Leisure Centre, Lancaster",
      course: "SC",
      meet_type: "club-gala",
      licence: "",
      is_home: true,
      entry_status: "",
      entry_url: "",
      stream_url: "",
      description: "",
      results_note: "",
      published: false,
      is_live: false,
    }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const FIELDS: Field[] = [
    { name: "name", label: "Gala name", type: "text", required: true,
      placeholder: `Carnforth Otters Winter Gala ${thisYear}` },
    { name: "slug", label: "URL slug", type: "text", required: true, half: true,
      placeholder: `winter-gala-${thisYear}`,
      help: "The permanent web address. Include the year so each edition keeps its own page." },
    { name: "series_id", label: "Series", type: "select", half: true,
      options: series.map((s) => ({ value: s.id, label: s.name })),
      help: "Groups this gala with its other years." },
    { name: "edition_year", label: "Year", type: "number", half: true, defaultValue: thisYear },
    { name: "meet_type", label: "Type", type: "select", half: true,
      options: [
        { value: "club-gala", label: "Club gala" },
        { value: "open-meet", label: "Open meet" },
        { value: "league", label: "League fixture" },
        { value: "other", label: "Other" },
      ] },
    { name: "start_date", label: "First day", type: "date", half: true },
    { name: "end_date", label: "Last day", type: "date", half: true,
      help: "Leave blank for a one-day gala." },
    { name: "venue", label: "Venue", type: "text", half: true },
    { name: "course", label: "Pool", type: "select", half: true,
      options: [
        { value: "SC", label: "Short course (25m)" },
        { value: "LC", label: "Long course (50m)" },
      ] },
    { name: "licence", label: "Licence number", type: "text", half: true,
      placeholder: "3ER260123", help: "Shown as a badge. Leave blank for unlicensed galas." },
    { name: "entry_status", label: "Entries", type: "select", half: true,
      options: [
        { value: "soon", label: "Opening soon" },
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ] },
    { name: "entry_url", label: "Entry link", type: "url",
      placeholder: "https://carnforth.swimmanager.co.uk/…" },
    { name: "stream_url", label: "Live stream link", type: "url",
      placeholder: "https://www.youtube.com/@carnforth_otters" },
    { name: "description", label: "About this gala", type: "markdown",
      help: "Shown above the programme. Markdown: ## for headings, ** for bold, - for bullets." },
    { name: "results_note", label: "Notice on the results page", type: "textarea",
      placeholder: "Session 3 results are provisional pending a referee decision.",
      help: "Optional. Appears as a highlighted note. Clear it when no longer needed." },
    { name: "is_home", label: "We are hosting this one", type: "boolean", defaultValue: true },
    { name: "published", label: "Published — visible on the site", type: "boolean" },
    { name: "is_live", label: "Force onto the Live page", type: "boolean" },
  ];

  const setValue = (name: string, value: unknown) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      // Auto-fill the slug from the name until someone edits it by hand.
      if (name === "name" && isNew && !current.slug) {
        next.slug = slugify(String(value));
      }
      return next;
    });
    setSaved(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload: Row = {};
    for (const field of FIELDS) payload[field.name] = values[field.name] ?? null;

    try {
      const response = await fetch(
        isNew ? "/api/admin/records/galas" : `/api/admin/records/galas?id=${values.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          data.error?.includes("duplicate")
            ? "That URL slug is already used by another gala. Try adding the year."
            : (data.error ?? "Save failed.")
        );
        setBusy(false);
        return;
      }
      if (isNew) router.push(`/admin/galas/${data.record.id}`);
      else { setSaved(true); router.refresh(); }
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!values.id) return;
    if (!confirm(`Delete "${values.name}" and every result attached to it? This cannot be undone.`)) return;
    setBusy(true);
    await fetch(`/api/admin/records/galas?id=${values.id}`, { method: "DELETE" });
    router.push("/admin/galas");
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card p-6">
      <div className="flex items-center justify-between gap-4 mb-5">
        <h2 className="text-lg">{isNew ? "New gala" : "Gala details"}</h2>
        {!isNew && typeof values.slug === "string" && values.slug && (
          <a
            href={`/results/${values.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            View page
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {FIELDS.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(v) => setValue(field.name, v)}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-800">
          <Check className="h-4 w-4" aria-hidden />
          Saved.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-60">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          {isNew ? "Create gala" : "Save changes"}
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={remove}
            className="btn btn-ghost text-red-700 border-red-200 hover:bg-red-50 hover:border-red-300 ml-auto"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete gala
          </button>
        )}
      </div>
    </form>
  );
}
