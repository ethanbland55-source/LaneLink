import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CalendarDays, ExternalLink, MapPin, Radio, Ruler } from "lucide-react";
import MeetPortal from "@/components/results/meet-portal";
import { Prose } from "@/components/ui";
import {
  getGala, getGalaEvents, getGalaFiles, getGalaResults, getGalaSessions, getGalas,
} from "@/lib/queries";
import {
  courseLabel, formatDateRange, galaStatus, markdownToHtml, meetTypeLabel,
} from "@/lib/format";

export const revalidate = 30;

export async function generateStaticParams() {
  const galas = await getGalas({ limit: 40 });
  return galas.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const gala = await getGala(slug);
  if (!gala) return { title: "Gala not found" };
  return {
    title: `${gala.name} — results`,
    description:
      gala.description ??
      `Start lists, results and splits from ${gala.name}${gala.venue ? ` at ${gala.venue}` : ""}.`,
  };
}

const STATUS_COPY = {
  live: { label: "Live now", tone: "badge-live" },
  upcoming: { label: "Upcoming", tone: "badge-brand" },
  recent: { label: "Results published", tone: "badge-gold" },
  archived: { label: "Archived", tone: "badge-muted" },
} as const;

export default async function GalaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gala = await getGala(slug);
  if (!gala) notFound();

  const [sessions, events, files, results] = await Promise.all([
    getGalaSessions(gala.id),
    getGalaEvents(gala.id),
    getGalaFiles(gala.id),
    getGalaResults(gala.id),
  ]);

  const status = galaStatus(gala);
  const statusCopy = STATUS_COPY[status];

  // Map event ids to numbers so the search index stays small over the wire.
  const eventNumberById = new Map(events.map((e) => [e.id, e.number]));
  const index = results.map((r) => ({
    event_number: eventNumberById.get(r.event_id) ?? 0,
    swimmer_name: r.swimmer_name,
    club: r.club,
    place: r.place,
    swim_time: r.swim_time,
    status: r.status,
    is_home_club: r.is_home_club,
  }));

  return (
    <>
      <div id="top" />
      <section className="bg-deep lane-lines text-white">
        <div className="container-page py-12 md:py-16">
          <nav aria-label="Breadcrumb" className="mb-5">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.82rem] text-brand-200/80">
              <li><Link href="/results" className="hover:text-white">Results</Link></li>
              {gala.series && (
                <li className="flex items-center gap-2">
                  <span aria-hidden className="text-brand-300/50">/</span>
                  <Link href={`/results/series/${gala.series.slug}`} className="hover:text-white">
                    {gala.series.name}
                  </Link>
                </li>
              )}
            </ol>
          </nav>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={`badge ${statusCopy.tone}`}>
              {status === "live" && <span className="live-dot" aria-hidden />}
              {statusCopy.label}
            </span>
            <span className="badge badge-muted">{meetTypeLabel(gala.meet_type)}</span>
            {gala.licence && <span className="badge badge-muted">Licence {gala.licence}</span>}
          </div>

          <h1 className="text-white text-[clamp(1.9rem,4.6vw,3rem)] max-w-4xl">{gala.name}</h1>

          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-[0.95rem] text-brand-100/85">
            {gala.start_date && (
              <div className="flex items-center gap-2.5">
                <CalendarDays className="h-4 w-4 text-gold-400" aria-hidden />
                <dd>{formatDateRange(gala.start_date, gala.end_date)}</dd>
              </div>
            )}
            {gala.venue && (
              <div className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 text-gold-400" aria-hidden />
                <dd>{gala.venue}</dd>
              </div>
            )}
            {gala.course && (
              <div className="flex items-center gap-2.5">
                <Ruler className="h-4 w-4 text-gold-400" aria-hidden />
                <dd>{courseLabel(gala.course)}</dd>
              </div>
            )}
          </dl>

          {(gala.stream_url || gala.entry_url || status === "live") && (
            <div className="mt-8 flex flex-wrap gap-3">
              {status === "live" && (
                <Link href="/live" className="btn btn-primary">
                  <span className="live-dot text-brand-950" aria-hidden />
                  Live page
                </Link>
              )}
              {gala.stream_url && (
                <a
                  href={gala.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-onDark"
                >
                  <Radio className="h-4 w-4" aria-hidden />
                  Watch the stream
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
              {gala.entry_url && status === "upcoming" && (
                <a
                  href={gala.entry_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-onDark"
                >
                  Enter this meet
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          )}
        </div>
      </section>

      {gala.description && (
        <div className="container-page pt-10">
          <Prose html={markdownToHtml(gala.description)} />
        </div>
      )}

      {gala.results_note && (
        <div className="container-page pt-8">
          <div className="card p-5 bg-gold-100 border-gold-200 text-[0.92rem] text-brand-900 max-w-3xl">
            {gala.results_note}
          </div>
        </div>
      )}

      <MeetPortal
        galaSlug={gala.slug}
        homeClub="Carnforth Otters"
        sessions={sessions}
        events={events}
        files={files}
        index={index}
      />
    </>
  );
}
