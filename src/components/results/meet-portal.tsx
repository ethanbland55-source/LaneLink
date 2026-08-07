"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ChevronUp, Download, FileText, ListOrdered, Search, Timer, Trophy, X,
} from "lucide-react";
import type { GalaEvent, GalaFile, GalaResult, GalaSession } from "@/lib/types";
import { FILE_GROUPS } from "@/lib/types";
import { formatFileSize, formatWeekday, ordinal } from "@/lib/format";

type Props = {
  galaSlug: string;
  homeClub: string;
  sessions: GalaSession[];
  events: GalaEvent[];
  files: GalaFile[];
  /** Trimmed result rows — enough to power search and the medal table. */
  index: {
    event_number: number;
    swimmer_name: string;
    club: string | null;
    place: number | null;
    swim_time: string | null;
    status: string | null;
    is_home_club: boolean;
  }[];
};

const ROUND_LABEL: Record<string, string> = {
  HEATS: "Heats",
  FINAL: "Final",
  SEMI: "Semi",
  TIMEDFINAL: "Results",
  SWIMOFF: "Swim-off",
  QUARTER: "Quarter",
};

export default function MeetPortal({
  galaSlug, homeClub, sessions, events, files, index,
}: Props) {
  const [query, setQuery] = useState("");
  const [homeOnly, setHomeOnly] = useState(false);
  const [tab, setTab] = useState<"programme" | "search" | "medals" | "downloads">("programme");

  const eventsBySession = useMemo(() => {
    const map = new Map<string, GalaEvent[]>();
    for (const event of events) {
      const key = event.session_id ?? "unsorted";
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);

  const eventByNumber = useMemo(() => {
    const map = new Map<number, GalaEvent>();
    for (const e of events) map.set(e.number, e);
    return map;
  }, [events]);

  /* ---- Swimmer search ---------------------------------------------------- */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 && !homeOnly) return [];
    return index
      .filter((r) => {
        if (homeOnly && !r.is_home_club) return false;
        if (q.length < 2) return true;
        return (
          r.swimmer_name.toLowerCase().includes(q) ||
          (r.club ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, 400);
  }, [query, homeOnly, index]);

  /* ---- Medal table ------------------------------------------------------- */
  const medals = useMemo(() => {
    const table = new Map<string, { club: string; gold: number; silver: number; bronze: number }>();
    for (const r of index) {
      if (!r.place || r.place > 3 || r.status) continue;
      const club = r.club ?? "Unattached";
      const row = table.get(club) ?? { club, gold: 0, silver: 0, bronze: 0 };
      if (r.place === 1) row.gold += 1;
      else if (r.place === 2) row.silver += 1;
      else row.bronze += 1;
      table.set(club, row);
    }
    return [...table.values()].sort(
      (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.club.localeCompare(b.club)
    );
  }, [index]);

  const filesByGroup = useMemo(() => {
    const map = new Map<string, GalaFile[]>();
    for (const f of files) {
      const list = map.get(f.group_key);
      if (list) list.push(f);
      else map.set(f.group_key, [f]);
    }
    return map;
  }, [files]);

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, GalaSession[]>();
    for (const s of sessions) {
      const key = s.session_date ?? "";
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    return [...map.entries()];
  }, [sessions]);

  const hasResults = events.some((e) => e.has_results);

  const TABS = [
    { key: "programme" as const, label: "Programme", Icon: ListOrdered },
    { key: "search" as const, label: "Find a swimmer", Icon: Search, hidden: !index.length },
    { key: "medals" as const, label: "Medal table", Icon: Trophy, hidden: medals.length === 0 },
    { key: "downloads" as const, label: "Downloads", Icon: Download, hidden: files.length === 0 },
  ].filter((t) => !t.hidden);

  return (
    <div className="container-page py-10 md:py-14">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-ink-200 pb-4">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.9rem] font-semibold transition-colors ${
              tab === key
                ? "bg-brand-700 text-white"
                : "text-ink-600 hover:bg-brand-50 hover:text-brand-800"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------- Programme tab */}
      {tab === "programme" && (
        <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
          {/* Session jump list */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-6">
              <div>
                <p className="eyebrow mb-3">Move to session</p>
                <div className="space-y-3">
                  {sessionsByDate.map(([date, list]) => (
                    <div key={date}>
                      {date && (
                        <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-ink-400 mb-1.5">
                          {formatWeekday(date)}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((s) => (
                          <a
                            key={s.id}
                            href={`#session-${s.number}`}
                            className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-ink-200 px-2.5 text-sm font-semibold text-brand-800 hover:border-brand-400 hover:bg-brand-50 transition-colors"
                          >
                            {s.number}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-4">
                <p className="text-[0.8rem] text-ink-500 leading-snug">
                  <strong className="text-brand-800">{homeClub}</strong> swims are highlighted
                  in gold throughout.
                </p>
              </div>
            </div>
          </aside>

          {/* Sessions */}
          <div className="space-y-10">
            {sessions.length === 0 && (
              <p className="text-ink-500">No sessions have been published for this gala yet.</p>
            )}

            {sessions.map((session) => {
              const sessionEvents = eventsBySession.get(session.id) ?? [];
              return (
                <section key={session.id} id={`session-${session.number}`} className="scroll-mt-header">
                  <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-xl md:text-2xl">
                        Session {session.number}
                        {session.name ? ` — ${session.name}` : ""}
                      </h2>
                      <p className="mt-1 text-[0.9rem] text-ink-500">
                        {[
                          session.session_date ? formatWeekday(session.session_date) : null,
                          session.warmup_time ? `Warm-up ${session.warmup_time}` : null,
                          session.start_time ? `Start ${session.start_time}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {sessionEvents.length > 0 && (
                        <p className="mt-2">
                          {sessionEvents.every((e) => e.has_results) ? (
                            <span className="badge badge-muted">Complete</span>
                          ) : sessionEvents.some((e) => e.has_results) ? (
                            <span className="badge badge-live">
                              <span className="live-dot" aria-hidden />
                              Results coming in
                            </span>
                          ) : sessionEvents.some((e) => e.has_start_list) ? (
                            <span className="badge badge-gold">Heats published</span>
                          ) : (
                            <span className="badge badge-brand">
                              Heats published at the warm-up
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {session.start_list_url && (
                        <a
                          href={session.start_list_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          <FileText className="h-4 w-4" aria-hidden />
                          Start lists
                        </a>
                      )}
                      {session.results_url && (
                        <a
                          href={session.results_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          <FileText className="h-4 w-4" aria-hidden />
                          Results PDF
                        </a>
                      )}
                      <a
                        href="#top"
                        className="btn btn-ghost btn-sm text-ink-400"
                        aria-label="Back to top"
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden />
                      </a>
                    </div>
                  </div>

                  {sessionEvents.length === 0 ? (
                    <div className="card p-6 text-ink-500 text-[0.92rem]">
                      No events listed for this session yet.
                    </div>
                  ) : (
                    <div className="card overflow-hidden">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-ink-50 border-b border-ink-200">
                            <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-wider text-ink-500">
                              Event
                            </th>
                            <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-wider text-ink-500 w-28 text-right">
                              Start
                            </th>
                            <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-wider text-ink-500 w-32 text-right">
                              Result
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sessionEvents.map((event) => (
                            <tr
                              key={event.id}
                              className="border-b border-ink-100 last:border-0 hover:bg-brand-50/60 transition-colors"
                            >
                              <td className="px-4 py-3">
                                <span className="tnum font-semibold text-brand-800 mr-2">
                                  {event.number}
                                </span>
                                <span className="text-ink-800">{event.name}</span>
                                {event.age_group && (
                                  <span className="ml-2 text-[0.8rem] text-ink-400">
                                    {event.age_group}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {event.has_start_list ? (
                                  <Link
                                    href={`/results/${galaSlug}/events/${event.number}?view=start`}
                                    className="text-[0.88rem] font-semibold text-brand-600 hover:text-gold-700 hover:underline underline-offset-4"
                                  >
                                    Start
                                  </Link>
                                ) : event.start_list_url ? (
                                  <a
                                    href={event.start_list_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[0.88rem] font-semibold text-brand-600 hover:text-gold-700 hover:underline underline-offset-4"
                                  >
                                    Start
                                  </a>
                                ) : (
                                  <span
                                    className="text-ink-300 text-[0.88rem]"
                                    title="Heats are drawn at the warm-up for that session"
                                  >
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {event.has_results ? (
                                  <Link
                                    href={`/results/${galaSlug}/events/${event.number}`}
                                    className="text-[0.88rem] font-semibold text-brand-600 hover:text-gold-700 hover:underline underline-offset-4"
                                  >
                                    {ROUND_LABEL[event.round ?? ""] ?? "Results"}
                                  </Link>
                                ) : event.results_url ? (
                                  <a
                                    href={event.results_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[0.88rem] font-semibold text-brand-600 hover:text-gold-700 hover:underline underline-offset-4"
                                  >
                                    PDF
                                  </a>
                                ) : (
                                  <span className="text-ink-300 text-[0.88rem]">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}

            {!hasResults && sessions.length > 0 && (
              <div className="card p-6 bg-brand-50 border-brand-200">
                <p className="flex items-start gap-3 text-[0.92rem] text-brand-900">
                  <Timer className="h-5 w-5 shrink-0 mt-0.5 text-brand-500" aria-hidden />
                  <span>
                    Results are added session by session through the day, as soon as each event is
                    confirmed by the referee. Refresh this page for the latest.
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- Search tab */}
      {tab === "search" && (
        <div className="max-w-4xl">
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-ink-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by swimmer or club name…"
                aria-label="Search results by swimmer or club"
                className="w-full rounded-full border border-ink-200 bg-white pl-11 pr-10 py-3 text-[0.95rem] focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setHomeOnly((v) => !v)}
              aria-pressed={homeOnly}
              className={`btn shrink-0 ${homeOnly ? "btn-brand" : "btn-ghost"}`}
            >
              {homeClub} only
            </button>
          </div>

          {query.trim().length < 2 && !homeOnly ? (
            <p className="text-ink-500">
              Type at least two letters of a swimmer's or club's name, or filter to {homeClub}.
            </p>
          ) : searchResults.length === 0 ? (
            <p className="text-ink-500">No swims match that search.</p>
          ) : (
            <>
              <p className="text-[0.85rem] text-ink-500 mb-3">
                {searchResults.length}
                {searchResults.length === 400 ? "+" : ""} swims
              </p>
              <div className="card overflow-hidden overflow-x-auto">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Swimmer</th>
                      <th>Club</th>
                      <th className="text-right">Place</th>
                      <th className="text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((r, i) => {
                      const event = eventByNumber.get(r.event_number);
                      return (
                        <tr key={`${r.event_number}-${r.swimmer_name}-${i}`} className={r.is_home_club ? "is-home" : ""}>
                          <td>
                            <Link
                              href={`/results/${galaSlug}/events/${r.event_number}`}
                              className="text-brand-700 hover:underline underline-offset-4"
                            >
                              <span className="tnum font-semibold">{r.event_number}</span>{" "}
                              {event?.name ?? ""}
                            </Link>
                          </td>
                          <td className="font-medium">{r.swimmer_name}</td>
                          <td className="text-ink-500">{r.club ?? "—"}</td>
                          <td className="text-right tnum">
                            {r.status ? (
                              <span className="text-ink-400">{r.status}</span>
                            ) : (
                              ordinal(r.place)
                            )}
                          </td>
                          <td className="text-right tnum font-semibold">{r.swim_time ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- Medals tab */}
      {tab === "medals" && (
        <div className="max-w-2xl">
          <p className="text-ink-600 mb-5">
            Top three finishes across every event in this gala.
          </p>
          <div className="card overflow-hidden">
            <table className="results-table">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Club</th>
                  <th className="text-right">🥇</th>
                  <th className="text-right">🥈</th>
                  <th className="text-right">🥉</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {medals.map((row, i) => (
                  <tr key={row.club} className={row.club === homeClub ? "is-home" : ""}>
                    <td className="tnum text-ink-400">{i + 1}</td>
                    <td className="font-medium">{row.club}</td>
                    <td className="text-right tnum">{row.gold}</td>
                    <td className="text-right tnum">{row.silver}</td>
                    <td className="text-right tnum">{row.bronze}</td>
                    <td className="text-right tnum font-semibold">
                      {row.gold + row.silver + row.bronze}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- Downloads tab */}
      {tab === "downloads" && (
        <div className="max-w-3xl space-y-8">
          {FILE_GROUPS.map((group) => {
            const list = filesByGroup.get(group.key);
            if (!list?.length) return null;
            return (
              <div key={group.key}>
                <h2 className="text-lg">{group.label}</h2>
                <p className="text-[0.88rem] text-ink-500 mt-0.5 mb-3">{group.note}</p>
                <ul className="card divide-y divide-ink-100">
                  {list.map((file) => (
                    <li key={file.id}>
                      <a
                        href={file.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-5 py-3.5 hover:bg-brand-50 transition-colors"
                      >
                        <FileText className="h-4.5 w-4.5 shrink-0 text-brand-400" aria-hidden />
                        <span className="flex-1 font-medium text-brand-900">{file.label}</span>
                        {file.file_size ? (
                          <span className="text-[0.8rem] text-ink-400 tnum">
                            {formatFileSize(file.file_size)}
                          </span>
                        ) : null}
                        <Download className="h-4 w-4 text-ink-400" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
