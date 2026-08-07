import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ExternalLink, FileText, Radio, Youtube } from "lucide-react";
import AutoRefresh from "@/components/auto-refresh";
import { EmptyState, PageHero, Section } from "@/components/ui";
import {
  getClubSettings, getGalaEvents, getGalaFiles, getGalaSessions, getLiveGala, getUpcomingGalas,
} from "@/lib/queries";
import { formatDateRange, formatWeekday } from "@/lib/format";

// Short window so gala-day updates land quickly.
export const revalidate = 15;

export const metadata: Metadata = {
  title: "Live gala results",
  description:
    "Results as they happen from galas hosted by Carnforth Otters — heat sheets, event results and the live stream.",
};

export default async function LivePage() {
  const [club, gala, upcoming] = await Promise.all([
    getClubSettings(),
    getLiveGala(),
    getUpcomingGalas(3),
  ]);

  if (!gala) {
    return (
      <>
        <PageHero
          eyebrow="Competing"
          title="Live gala results"
          intro="When we're hosting, this page carries heat sheets and results as each event is confirmed — plus the link to the live stream."
        />
        <Section title="">
          <EmptyState
            icon={<Radio className="h-6 w-6" />}
            title="Nothing live right now"
            message="There's no gala running at the moment. This page wakes up automatically on the morning of a home gala — no need to check back for a link."
            action={
              <div className="flex flex-wrap gap-3 justify-center">
                <Link href="/results" className="btn btn-brand btn-sm">Results archive</Link>
                {club.youtube && (
                  <a
                    href={club.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                  >
                    <Youtube className="h-4 w-4" aria-hidden />
                    Our channel
                  </a>
                )}
              </div>
            }
          />

          {upcoming.length > 0 && (
            <div className="mt-10">
              <p className="eyebrow mb-4">Next up</p>
              <ul className="card divide-y divide-ink-100">
                {upcoming.map((g) => (
                  <li key={g.id}>
                    <Link
                      href={`/results/${g.slug}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-brand-50 transition-colors"
                    >
                      <span className="flex-1">
                        <span className="block font-semibold text-brand-900">{g.name}</span>
                        <span className="block text-[0.85rem] text-ink-500">
                          {formatDateRange(g.start_date, g.end_date)}
                          {g.venue ? ` · ${g.venue}` : ""}
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 text-ink-400" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </>
    );
  }

  const [sessions, events, files] = await Promise.all([
    getGalaSessions(gala.id),
    getGalaEvents(gala.id),
    getGalaFiles(gala.id),
  ]);

  const withResults = events.filter((e) => e.has_results);
  const latest = withResults.slice(-12).reverse();
  const done = withResults.length;
  const total = events.length;
  const resultFiles = files.filter((f) => f.group_key === "results" || f.group_key === "warmup");

  return (
    <>
      <section className="bg-deep lane-lines text-white">
        <div className="container-page py-12 md:py-16">
          <span className="badge badge-live mb-4">
            <span className="live-dot" aria-hidden />
            Live now
          </span>
          <h1 className="text-white text-[clamp(1.9rem,4.6vw,3rem)]">{gala.name}</h1>
          <p className="mt-3 text-brand-100/85">
            {[formatDateRange(gala.start_date, gala.end_date), gala.venue]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/results/${gala.slug}`} className="btn btn-primary">
              Full programme &amp; results
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {(gala.stream_url || club.youtube) && (
              <a
                href={gala.stream_url ?? club.youtube}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-onDark"
              >
                <Youtube className="h-4 w-4" aria-hidden />
                Watch live
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </div>

          {total > 0 && (
            <div className="mt-10 max-w-md">
              <div className="flex justify-between text-[0.82rem] text-brand-100/80 mb-2">
                <span>Events completed</span>
                <span className="tnum font-semibold text-gold-400">{done} of {total}</span>
              </div>
              <div className="h-2 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold-500 transition-all duration-700"
                  style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="container-page py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-7">
          <h2 className="text-xl md:text-2xl">Just published</h2>
          <AutoRefresh seconds={30} />
        </div>

        {latest.length === 0 ? (
          <EmptyState
            icon={<Radio className="h-6 w-6" />}
            title="Nothing published yet"
            message="The first results will appear here as soon as the opening event is confirmed. This page updates itself — leave it open."
          />
        ) : (
          <ul className="card divide-y divide-ink-100">
            {latest.map((event) => {
              const session = sessions.find((s) => s.id === event.session_id);
              return (
                <li key={event.id}>
                  <Link
                    href={`/results/${gala.slug}/events/${event.number}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-brand-50 transition-colors"
                  >
                    <span className="tnum font-bold text-brand-700 w-12 shrink-0">
                      {event.number}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-brand-900 truncate">{event.name}</span>
                      <span className="block text-[0.82rem] text-ink-500">
                        {[
                          session ? `Session ${session.number}` : null,
                          session?.session_date ? formatWeekday(session.session_date) : null,
                          event.age_group,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-ink-400 shrink-0" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {resultFiles.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xl mb-4">Heat sheets &amp; PDFs</h2>
            <ul className="card divide-y divide-ink-100">
              {resultFiles.map((file) => (
                <li key={file.id}>
                  <a
                    href={file.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-brand-50 transition-colors"
                  >
                    <FileText className="h-4.5 w-4.5 shrink-0 text-brand-400" aria-hidden />
                    <span className="flex-1 font-medium text-brand-900">{file.label}</span>
                    <ExternalLink className="h-4 w-4 text-ink-400" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
