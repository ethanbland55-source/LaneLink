"use client";

import { useState } from "react";
import {
  Check, ChevronDown, Copy, Eye, EyeOff, FileText, Radio, RotateCcw, Timer,
} from "lucide-react";

/**
 * Everything needed to make a gala publish itself, written for a volunteer who
 * has never seen the site before.
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
  const [open, setOpen] = useState(true);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [currentToken, setCurrentToken] = useState(token);

  const siteUrl =
    typeof window !== "undefined" ? window.location.origin : "https://carnforthotters.co.uk";

  const command =
    `node otters-poster.mjs --token ${currentToken ?? "<token>"} ^\n` +
    `  --dir  "C:\\SPORTSYS\\SSMeet\\<meet folder>\\webpages" ^\n` +
    `  --live "C:\\SPORTSYS\\SSMeet\\<meet folder>\\LiveRes" ^\n` +
    `  --url  ${siteUrl}`;

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2200);
  };

  const rotate = async () => {
    if (!confirmingRotate) { setConfirmingRotate(true); return; }
    setConfirmingRotate(false);
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
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-6 text-left hover:bg-brand-50/60 transition-colors"
        aria-expanded={open}
      >
        <Radio className="h-5 w-5 text-brand-500 shrink-0" aria-hidden />
        <span className="flex-1">
          <span className="block text-lg font-[family-name:var(--font-heading)] font-bold text-brand-900">
            Gala day: heat sheets &amp; live results
          </span>
          <span className="block text-[0.88rem] text-ink-500 mt-0.5">
            Set this up once and the site keeps itself up to date all day
          </span>
        </span>
        {lastFileAt && (
          <span className="badge badge-open hidden sm:inline-flex">Receiving files</span>
        )}
        <ChevronDown
          className={`h-5 w-5 text-ink-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="px-6 pb-6 space-y-6 border-t border-ink-100 pt-6">
          {/* ------------------------------------------------ How it works -- */}
          <div className="rounded-xl bg-brand-50 border border-brand-200 p-4 text-[0.9rem] text-ink-700">
            <p className="font-semibold text-brand-900 mb-1.5">How this works</p>
            <p>
              Meet Organisation already saves heat sheets and results to the meet laptop as the
              gala runs. A small program watches that folder and sends each new file straight to
              this website. <strong>Nobody uploads anything on the day.</strong>
            </p>
            <p className="mt-2 text-ink-600">
              Heat sheets appear when you draw each session&rsquo;s heats — that&rsquo;s why the
              afternoon heats aren&rsquo;t visible during the morning session. Results appear
              within seconds of each event being confirmed.
            </p>
          </div>

          {/* ------------------------------------------------------- Steps -- */}
          <Step n={1} title="Before the gala — put the file on the meet laptop">
            <p>
              Copy <code>scripts/otters-poster.mjs</code> from the website folder onto the laptop
              that runs Meet Organisation. Anywhere is fine — the Desktop is easiest.
            </p>
            <p className="mt-2 text-ink-500">
              The laptop needs Node (version 18 or newer) and an internet connection. If Node
              isn&rsquo;t installed, get it from <code>nodejs.org</code> — the default options are
              fine.
            </p>
          </Step>

          <Step n={2} title="Find this meet's folder">
            <p>
              Open <code>C:\SPORTSYS\SSMeet\</code> and find the folder for this gala. Inside it
              you want two folders:
            </p>
            <ul className="mt-2 space-y-1">
              <li>
                <code>webpages</code> — where heat sheets and results are written
              </li>
              <li>
                <code>LiveRes</code> — the rolling &ldquo;last race&rdquo; panel
              </li>
            </ul>
            <p className="mt-2 text-ink-500">
              If <code>webpages</code> doesn&rsquo;t exist yet, run{" "}
              <strong>Before Meet → Make Web Pages Indexes</strong> in Meet Organisation once.
            </p>
          </Step>

          <Step n={3} title="Copy this gala's upload token">
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <code className="flex-1 min-w-56 rounded-lg bg-ink-100 px-3 py-2 text-[0.85rem] font-mono break-all">
                {currentToken
                  ? revealed
                    ? currentToken
                    : "•".repeat(32)
                  : "not set — save the gala first"}
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
                className={`btn btn-sm ${confirmingRotate ? "bg-amber-500 text-brand-950 hover:bg-amber-400" : "btn-ghost text-ink-500"}`}
                title="Issue a new token and invalidate the old one"
              >
                <RotateCcw className="h-4 w-4" />
                {confirmingRotate ? "Confirm — old token stops working" : "New"}
              </button>
              {confirmingRotate && (
                <button
                  type="button"
                  onClick={() => setConfirmingRotate(false)}
                  className="btn btn-ghost btn-sm"
                >
                  Cancel
                </button>
              )}
            </div>
            <p className="mt-2 text-ink-500">
              This token only works for this one gala, so it&rsquo;s safe to hand to whoever runs
              the timing. It can&rsquo;t reach any other gala or any other part of the site.
            </p>
          </Step>

          <Step n={4} title="Start it before the first warm-up">
            <p>
              Open a Command Prompt in the folder where you put the file, then paste this in and
              press Enter. Replace <code>&lt;meet folder&gt;</code> with the real folder name.
            </p>
            <div className="relative mt-3">
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
            <p className="mt-2 text-ink-500">
              Leave the window open for the whole gala. It prints a line for every file it sends,
              so you can see it working.
            </p>
          </Step>

          <Step n={5} title="Check it's working">
            <p>
              Draw the first session&rsquo;s heats in Meet Organisation, then refresh this page.
              The green &ldquo;Receiving files&rdquo; badge and the times below should appear
              within about ten seconds.
            </p>
            <p className="mt-2">
              On the public gala page, the first session should flip from{" "}
              <span className="badge badge-brand">Heats published at the warm-up</span> to{" "}
              <span className="badge badge-gold">Heats published</span>.
            </p>
          </Step>

          <Step n={6} title="After the gala — the permanent archive" last>
            <p>
              In Meet Organisation choose <strong>File → Export → Lenex</strong> and upload that
              file in the &ldquo;Import results&rdquo; box below. It replaces what was published
              live with the official version: full splits, confirmed places and relay legs.
            </p>
            <p className="mt-2 text-ink-500">
              Optional, but it&rsquo;s what turns a day&rsquo;s live coverage into a proper
              archive. Stop the poster program afterwards.
            </p>
          </Step>

          {/* ------------------------------------------------------ Status -- */}
          {(lastFileAt || liveUpdatedAt) && (
            <dl className="grid gap-3 sm:grid-cols-2 text-[0.85rem]">
              {lastFileAt && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-3.5 py-2.5">
                  <dt className="flex items-center gap-1.5 text-green-900/60">
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Last file received
                  </dt>
                  <dd className="font-semibold text-green-900 mt-0.5">{when(lastFileAt)}</dd>
                </div>
              )}
              {liveUpdatedAt && (
                <div className="rounded-lg bg-aqua-100 border border-aqua-400 px-3.5 py-2.5">
                  <dt className="flex items-center gap-1.5 text-aqua-900/60">
                    <Timer className="h-3.5 w-3.5" aria-hidden />
                    Live panel updated
                  </dt>
                  <dd className="font-semibold text-aqua-900 mt-0.5">{when(liveUpdatedAt)}</dd>
                </div>
              )}
            </dl>
          )}

          {/* -------------------------------------------- If it goes wrong -- */}
          <details className="rounded-xl border border-ink-200 p-4">
            <summary className="cursor-pointer font-semibold text-brand-900 text-[0.92rem]">
              If something isn&rsquo;t appearing
            </summary>
            <ul className="mt-3 space-y-2 text-[0.88rem] text-ink-600">
              <li>
                <strong className="text-brand-900">Nothing at all?</strong> Check the Command
                Prompt window is still open and hasn&rsquo;t printed errors. It retries failed
                files automatically, so a brief dropout fixes itself.
              </li>
              <li>
                <strong className="text-brand-900">&ldquo;Upload token not recognised&rdquo;?</strong>{" "}
                The token was copied wrong, or a new one has been issued since. Copy it again from
                step 3.
              </li>
              <li>
                <strong className="text-brand-900">Heats missing for a later session?</strong>{" "}
                That&rsquo;s normal — Meet Organisation only writes them when you draw that
                session&rsquo;s heats.
              </li>
              <li>
                <strong className="text-brand-900">Wrong results published?</strong> Fix them in
                Meet Organisation and re-print. The corrected file is sent automatically and
                replaces the old one — it never doubles up.
              </li>
              <li>
                <strong className="text-brand-900">Worst case</strong>, the PDF results sheets
                still upload, so people can always download them from the gala page.
              </li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Step({
  n, title, children, last = false,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-white font-[family-name:var(--font-heading)] font-bold text-sm">
          {n}
        </span>
        {!last && <span className="w-px flex-1 bg-ink-200 mt-2" aria-hidden />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-2"}`}>
        <h3 className="text-[1.02rem] font-[family-name:var(--font-heading)] font-semibold text-brand-900">
          {title}
        </h3>
        <div className="mt-1.5 text-[0.9rem] text-ink-700 [&_code]:bg-ink-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </div>
    </div>
  );
}
