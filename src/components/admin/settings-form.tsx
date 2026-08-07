"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import type { ClubSettings } from "@/lib/types";

const FIELDS: { key: keyof ClubSettings; label: string; help?: string; half?: boolean }[] = [
  { key: "name", label: "Full club name" },
  { key: "shortName", label: "Short name", half: true },
  { key: "email", label: "General enquiries email", half: true,
    help: "Shown in the footer." },
  { key: "emailMembership", label: "Membership email", half: true },
  { key: "emailCompetitions", label: "Competitions email", half: true },
  { key: "emailWelfare", label: "Welfare Officer email", half: true },
  { key: "emailSecretary", label: "Secretary email", half: true },
  { key: "emailChair", label: "Chair email", half: true },
  { key: "emailWebsite", label: "Website email", half: true },
  { key: "tagline", label: "Tagline" },
  { key: "strapline", label: "Strapline", help: "The sentence under the headline on the home page and in the footer." },
  { key: "primaryVenue", label: "Main venue", half: true },
  { key: "swimManager", label: "SwimManager URL", half: true },
  { key: "facebook", label: "Facebook", half: true },
  { key: "youtube", label: "YouTube", half: true },
  { key: "instagram", label: "Instagram", half: true },
];

export default function SettingsForm({ club }: { club: ClubSettings }) {
  const router = useRouter();
  const [values, setValues] = useState<ClubSettings>(club);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/admin/records/site_settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "club", value: values }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error ?? "Save failed.");
      else { setSaved(true); router.refresh(); }
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  };

  return (
    <form onSubmit={save} className="card p-6">
      <h2 className="text-lg mb-5">Club details</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.half ? "" : "md:col-span-2"}>
            <label
              htmlFor={`setting-${field.key}`}
              className="block text-sm font-semibold text-brand-900 mb-1.5"
            >
              {field.label}
            </label>
            <input
              id={`setting-${field.key}`}
              type="text"
              value={String(values[field.key] ?? "")}
              onChange={(e) => {
                setValues((v) => ({ ...v, [field.key]: e.target.value }));
                setSaved(false);
              }}
              className="w-full rounded-xl border border-ink-200 px-3.5 py-2.5 text-[0.94rem] focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100"
            />
            {field.help && <p className="mt-1.5 text-[0.8rem] text-ink-500">{field.help}</p>}
          </div>
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

      <button type="submit" disabled={busy} className="btn btn-primary mt-6 disabled:opacity-60">
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        Save club details
      </button>
    </form>
  );
}
