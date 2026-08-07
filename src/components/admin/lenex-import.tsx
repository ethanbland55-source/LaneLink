"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Info, LoaderCircle } from "lucide-react";

type Summary = {
  meetName: string;
  sessions: number;
  events: number;
  eventsWithResults: number;
  results: number;
  homeSwims: number;
  clubs: number;
  dates: string;
  warnings: string[];
};

/**
 * Upload a Sportsystems Meet Organisation Lenex export and rebuild this gala's
 * sessions, events and results from it.
 */
export default function LenexImport({
  galaId,
  galaName,
  importedAt,
}: {
  galaId: string;
  galaName: string;
  importedAt: string | null;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [homeClub, setHomeClub] = useState("carnforth");
  const [syncDetails, setSyncDetails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirmedReplace, setConfirmedReplace] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    // Re-importing replaces this gala's results, so ask once — inline, not in a
    // browser dialog.
    if (importedAt && !confirmedReplace) {
      setConfirmedReplace(true);
      return;
    }

    setBusy(true);
    setError(null);
    setSummary(null);

    const form = new FormData();
    form.append("file", file);
    form.append("galaId", galaId);
    form.append("homeClub", homeClub);
    form.append("syncDetails", String(syncDetails));

    try {
      const response = await fetch("/api/admin/import/lenex", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error ?? "Import failed.");
      else { setSummary(data.summary); setFile(null); router.refresh(); }
    } catch {
      setError("Couldn't reach the server. Large files can time out — try again.");
    }
    setBusy(false);
  };

  return (
    <div className="card p-6">
      <h2 className="text-lg">Import results</h2>
      <p className="mt-1.5 text-[0.92rem] text-ink-600">
        In Meet Organisation choose <strong>File → Export → Lenex</strong>, then upload the{" "}
        <code>.lef</code> or <code>.lxf</code> file here. Sessions, events, heats, times and split
        times all come across in one go.
      </p>

      {importedAt && (
        <p className="mt-3 flex items-start gap-2 text-[0.85rem] text-ink-500">
          <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          Results were last imported on {new Date(importedAt).toLocaleString("en-GB")}. Uploading
          again replaces them.
        </p>
      )}

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="lenex-file" className="block text-sm font-semibold text-brand-900 mb-1.5">
            Lenex file
          </label>
          <input
            id="lenex-file"
            type="file"
            accept=".lef,.lxf,.zip,.xml"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[0.9rem] text-ink-600 file:mr-4 file:rounded-full file:border-0 file:bg-brand-700 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-600 file:cursor-pointer"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="home-club" className="block text-sm font-semibold text-brand-900 mb-1.5">
              Highlight club
            </label>
            <input
              id="home-club"
              type="text"
              value={homeClub}
              onChange={(e) => setHomeClub(e.target.value)}
              className="w-full rounded-xl border border-ink-200 px-3.5 py-2.5 text-[0.94rem] focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100"
            />
            <p className="mt-1.5 text-[0.8rem] text-ink-500">
              Any club name containing this text is highlighted in gold on the results tables.
            </p>
          </div>

          <label className="flex items-start gap-3 pt-7 cursor-pointer">
            <input
              type="checkbox"
              checked={syncDetails}
              onChange={(e) => setSyncDetails(e.target.checked)}
              className="mt-0.5 h-4.5 w-4.5 rounded border-ink-300 text-brand-700 focus:ring-brand-300"
            />
            <span className="text-[0.9rem]">
              <span className="font-semibold text-brand-900 block">Update gala details too</span>
              <span className="text-ink-500">
                Take the dates, venue and course length from the file.
              </span>
            </span>
          </label>
        </div>

        {confirmedReplace && !busy && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This replaces all existing results for <strong>{galaName}</strong>. Other galas are
            untouched. Press the button again to go ahead, or{" "}
            <button
              type="button"
              onClick={() => setConfirmedReplace(false)}
              className="underline underline-offset-2 font-semibold"
            >
              cancel
            </button>
            .
          </p>
        )}

        <button
          type="submit"
          disabled={!file || busy}
          className={`btn disabled:opacity-50 ${confirmedReplace ? "bg-amber-500 text-brand-950 hover:bg-amber-400" : "btn-primary"}`}
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileUp className="h-4 w-4" aria-hidden />
          )}
          {busy ? "Importing…" : confirmedReplace ? "Yes, replace the results" : "Import results"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {summary && (
        <div className="mt-5 rounded-xl bg-green-50 border border-green-200 p-4">
          <p className="flex items-center gap-2 font-semibold text-green-900">
            <CheckCircle2 className="h-4.5 w-4.5" aria-hidden />
            Imported “{summary.meetName}”
          </p>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[0.88rem] text-green-900/85">
            <div><dt className="text-green-900/60">Sessions</dt><dd className="tnum font-semibold">{summary.sessions}</dd></div>
            <div><dt className="text-green-900/60">Events</dt><dd className="tnum font-semibold">{summary.events}</dd></div>
            <div><dt className="text-green-900/60">With results</dt><dd className="tnum font-semibold">{summary.eventsWithResults}</dd></div>
            <div><dt className="text-green-900/60">Swims</dt><dd className="tnum font-semibold">{summary.results}</dd></div>
            <div><dt className="text-green-900/60">Otters swims</dt><dd className="tnum font-semibold">{summary.homeSwims}</dd></div>
            <div><dt className="text-green-900/60">Clubs</dt><dd className="tnum font-semibold">{summary.clubs}</dd></div>
          </dl>
          {summary.dates && (
            <p className="mt-3 text-[0.85rem] text-green-900/70">Dates: {summary.dates}</p>
          )}
          {summary.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-[0.85rem] text-amber-800">
              {summary.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {summary.homeSwims === 0 && summary.results > 0 && (
            <p className="mt-3 text-[0.85rem] text-amber-800">
              No swims were matched to “{homeClub}”. Check how the club name is spelled in Meet
              Organisation and re-import if you want them highlighted.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
