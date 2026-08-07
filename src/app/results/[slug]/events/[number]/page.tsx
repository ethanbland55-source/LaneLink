import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { EmptyState } from "@/components/ui";
import {
  getGala, getGalaEvent, getGalaEvents, getEventResults, getGalaSessions,
} from "@/lib/queries";
import { formatDateRange, ordinal } from "@/lib/format";
import type { GalaResult } from "@/lib/types";

export const revalidate = 30;

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string; number: string }> }
): Promise<Metadata> {
  const { slug, number } = await params;
  const gala = await getGala(slug);
  if (!gala) return { title: "Results" };
  const event = await getGalaEvent(gala.id, Number(number));
  return {
    title: event ? `${event.name} — ${gala.name}` : `Event ${number} — ${gala.name}`,
    description: event
      ? `Full results and splits for event ${event.number}, ${event.name}, at ${gala.name}.`
      : undefined,
  };
}

const ROUND_LABEL: Record<string, string> = {
  HEATS: "Heats",
  FINAL: "Final",
  SEMI: "Semi-final",
  TIMEDFINAL: "Timed final",
  SWIMOFF: "Swim-off",
  QUARTER: "Quarter-final",
};

export default async function EventResultsPage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number } = await params;
  const eventNumber = Number(number);
  if (!Number.isFinite(eventNumber)) notFound();

  const gala = await getGala(slug);
  if (!gala) notFound();

  const [event, allEvents, sessions] = await Promise.all([
    getGalaEvent(gala.id, eventNumber),
    getGalaEvents(gala.id),
    getGalaSessions(gala.id),
  ]);
  if (!event) notFound();

  const results = await getEventResults(event.id);
  const session = sessions.find((s) => s.id === event.session_id) ?? null;

  const ordered = allEvents.filter((e) => e.has_results);
  const position = ordered.findIndex((e) => e.id === event.id);
  const prev = position > 0 ? ordered[position - 1] : null;
  const next = position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null;

  // Split into age-group blocks, mirroring how results sheets are printed.
  const groups = new Map<string, GalaResult[]>();
  for (const r of results) {
    const key = r.is_final ? "Final" : "";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const blocks = [...groups.entries()];
  const showSplits = results.some((r) => r.splits?.length);
  const showPoints = results.some((r) => r.points !== null);

  return (
    <>
      <section className="bg-deep lane-lines text-white">
        <div className="container-page py-10 md:py-14">
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82rem] text-brand-200/80">
              <li><Link href="/results" className="hover:text-white">Results</Link></li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="text-brand-300/50">/</span>
                <Link href={`/results/${gala.slug}`} className="hover:text-white">{gala.name}</Link>
              </li>
            </ol>
          </nav>

          <p className="eyebrow text-gold-400">
            Event {event.number}
            {event.round ? ` · ${ROUND_LABEL[event.round] ?? event.round}` : ""}
            {session ? ` · Session ${session.number}` : ""}
          </p>
          <h1 className="mt-3 text-white text-[clamp(1.7rem,4.2vw,2.6rem)]">{event.name}</h1>
          <p className="mt-3 text-brand-100/80 text-[0.95rem]">
            {[event.age_group, formatDateRange(gala.start_date, gala.end_date)]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {event.results_url && (
            <a
              href={event.results_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-onDark btn-sm mt-6"
            >
              <FileText className="h-4 w-4" aria-hidden />
              Official PDF
            </a>
          )}
        </div>
      </section>

      <div className="container-page py-10 md:py-14">
        {results.length === 0 ? (
          <EmptyState
            title="No results yet for this event"
            message="Results are published as soon as the event is confirmed by the referee. Try again shortly."
            action={
              <Link href={`/results/${gala.slug}`} className="btn btn-brand btn-sm">
                Back to the programme
              </Link>
            }
          />
        ) : (
          <div className="space-y-10">
            {blocks.map(([label, rows]) => (
              <section key={label || "main"}>
                {label && <h2 className="text-xl mb-3">{label}</h2>}
                <div className="card overflow-hidden overflow-x-auto">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th className="w-14">Place</th>
                        <th>Name</th>
                        <th className="w-14 text-right">AaD</th>
                        <th>Club</th>
                        {results.some((r) => r.lane !== null) && (
                          <th className="w-14 text-right">Lane</th>
                        )}
                        <th className="text-right">Time</th>
                        {showPoints && <th className="w-20 text-right">Pts</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <ResultRow
                          key={r.id}
                          result={r}
                          showLane={results.some((x) => x.lane !== null)}
                          showPoints={showPoints}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}

            {showSplits && (
              <p className="text-[0.85rem] text-ink-400">
                Split times are shown beneath each swim where the timing system recorded them.
                A dash means that touchpad or button did not register.
              </p>
            )}
          </div>
        )}

        {/* Previous / next event */}
        <nav className="mt-12 flex flex-col sm:flex-row gap-3 justify-between" aria-label="Event navigation">
          {prev ? (
            <Link href={`/results/${gala.slug}/events/${prev.number}`} className="btn btn-ghost">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="truncate max-w-60">{prev.number} {prev.name}</span>
            </Link>
          ) : <span />}
          {next ? (
            <Link href={`/results/${gala.slug}/events/${next.number}`} className="btn btn-ghost">
              <span className="truncate max-w-60">{next.number} {next.name}</span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : <span />}
        </nav>
      </div>
    </>
  );
}

function ResultRow({
  result: r,
  showLane,
  showPoints,
}: {
  result: GalaResult;
  showLane: boolean;
  showPoints: boolean;
}) {
  const colSpan = 5 + (showLane ? 1 : 0) + (showPoints ? 1 : 0);
  const splits = Array.isArray(r.splits) ? r.splits : [];

  return (
    <>
      <tr className={r.is_home_club ? "is-home" : ""}>
        <td className="tnum font-semibold text-brand-800">
          {r.status ? <span className="text-ink-400 font-normal">—</span> : ordinal(r.place)}
        </td>
        <td className="font-medium">
          {r.swimmer_name}
          {r.relay_members?.length ? (
            <span className="block text-[0.78rem] text-ink-400 font-normal mt-0.5">
              {r.relay_members.map((m) => m.name).join(" · ")}
            </span>
          ) : null}
        </td>
        <td className="tnum text-right text-ink-500">{r.age ?? "—"}</td>
        <td className="text-ink-600">{r.club ?? "—"}</td>
        {showLane && <td className="tnum text-right text-ink-500">{r.lane ?? "—"}</td>}
        <td className="text-right tnum font-semibold">
          {r.status ? (
            <span className="text-ink-500 font-medium" title={r.dq_code ?? undefined}>
              {r.status}
            </span>
          ) : (
            r.swim_time ?? "—"
          )}
        </td>
        {showPoints && <td className="tnum text-right text-ink-500">{r.points ?? "—"}</td>}
      </tr>

      {splits.length > 0 && (
        <tr className="bg-transparent hover:bg-transparent">
          <td colSpan={colSpan} className="px-4 pt-0 pb-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.78rem] text-ink-500 tnum pl-1">
              {splits.map((s) => (
                <span key={s.distance}>
                  <span className="text-ink-400">{s.distance}m</span>{" "}
                  <span className="font-medium text-ink-700">{s.time}</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
