"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Radio, RotateCcw } from "lucide-react";

/**
 * Everything needed to make a gala publish itself.
 *
 * Meet Organisation already writes start lists and results into its `webpages`
 * folder as a meet runs — that's what ResPost currently FTPs to the old host.
 * The poster script does the same job over HTTPS, so results land on the site
 * within seconds of each race with nobody touching the website on the day.
 */
export default function GalaDayPanel({
  galaId,
  token,
  lastFileAt,
  liveUpdatedAt,
}: {
  galaId: string;
  token: string | null;
  lastFileAt: string | null;
  liveUpdatedAt: string | null;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentToken, setCurrentToken] = useState(token);

  const siteUrl =
    typeof window !== "undefined" ? window.location.origin : "https://carnforthotters.co.uk";

  const command =
    `node otters-poster.mjs --token ${currentToken ?? "<token>"} ` +
    `--dir "C:\\SPORTSYS\\SSMeet\\<meet folder>\\webpages" ` +
    `--live "C:\\SPORTSYS\\SSMeet\\<meet folder>\\LiveRes" ` +
    `--url ${siteUrl}`;

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2200);
  };

  const rotate = async () => {
    if (!confirm("Issue a new upload token? The old one stops working immediately.")) return;
    setBusy(true);
    const fresh =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const response = await fetch(`/api/admin/records/galas?id=${encodeURIComponent(galaId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingest_token: fresh }),
    });
    if (response.ok) setCurrentToken(fresh);
    setBusy(false);
  };

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="card p-6">
      <h2 className="text-lg flex items-center gap-2.5">
        <Radio className="h-5 w-5 text-brand-500" aria-hidden />
        Gala day: publish automatically
      </h2>
      <p className="mt-1.5 text-[0.92rem] text-ink-600">
        Run this on the laptop running Meet Organisation and the site keeps itself up to date all
        day — start lists appear when each session&rsquo;s heats are drawn, results appear as each
        event is processed.
      </p>

      <ol className="mt-5 space-y-3 text-[0.92rem] text-ink-700 list-decimal pl-5">
        <li>
          Copy <code>scripts/otters-poster.mjs</code> onto the meet laptop (it needs Node 18+,
          nothing else).
        </li>
        <li>
          Find this meet&rsquo;s folder under <code>C:\SPORTSYS\SSMeet\</code> — you want the{" "}
          <code>webpages</code> folder inside it.
        </li>
        <li>Open a terminal there and run the command below, before the first warm-up.</li>
        <li>Leave the window open for the whole gala.</li>
      </ol>

      <div className="mt-5">
        <p className="text-sm font-semibold text-brand-900 mb-1.5">Upload token for this gala</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 min-w-56 rounded-lg bg-ink-100 px-3 py-2 text-[0.85rem] font-mono break-all">
            {currentToken ? (revealed ? currentToken : "•".repeat(32)) : "not set — save the gala first"}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="btn btn-ghost btn-sm"
            disabled={!currentToken}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {revealed ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            onClick={() => currentToken && copy(currentToken, "token")}
            className="btn btn-ghost btn-sm"
            disabled={!currentToken}
          >
            {copied === "token" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "token" ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={rotate}
            disabled={busy}
            className="btn btn-ghost btn-sm text-ink-500"
            title="Issue a new token and invalidate the old one"
          >
            <RotateCcw className="h-4 w-4" />
            New token
          </button>
        </div>
        <p className="mt-1.5 text-[0.8rem] text-ink-500">
          This token only works for this one gala, so it&rsquo;s safe to hand to whoever is running
          the timing. It can&rsquo;t touch any other gala or any other part of the site.
        </p>
      </div>

      <div className="mt-5">
        <p className="text-sm font-semibold text-brand-900 mb-1.5">Command</p>
        <div className="relative">
          <pre className="rounded-lg bg-ink-900 text-ink-100 p-4 pr-12 text-[0.78rem] overflow-x-auto font-mono leading-relaxed">
{command}
          </pre>
          <button
            type="button"
            onClick={() => copy(command, "command")}
            className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
            aria-label="Copy command"
          >
            {copied === "command" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {(lastFileAt || liveUpdatedAt) && (
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-[0.85rem]">
          {lastFileAt && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3.5 py-2.5">
              <dt className="text-green-900/60">Last file received</dt>
              <dd className="font-semibold text-green-900">{when(lastFileAt)}</dd>
            </div>
          )}
          {liveUpdatedAt && (
            <div className="rounded-lg bg-aqua-100 border border-aqua-400 px-3.5 py-2.5">
              <dt className="text-aqua-900/60">Live panel updated</dt>
              <dd className="font-semibold text-aqua-900">{when(liveUpdatedAt)}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
