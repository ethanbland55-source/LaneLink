import Link from "next/link";
import type { Metadata } from "next";
import { Clock, MapPin, Waves } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getSquads, getVenues } from "@/lib/queries";
import { DAY_SHORT } from "@/lib/format";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Squads & training times",
  description:
    "Every Carnforth Otters squad from Development to Masters, with the full weekly training timetable across Salt Ayre, Carnforth and Heysham.",
};

export default async function TrainingPage() {
  const [squads, venues] = await Promise.all([getSquads(), getVenues()]);

  return (
    <>
      <PageHero
        eyebrow="Training"
        title="Squads & training times"
        intro="Swimmers are placed by ability, not age. Your coach will tell you when it's time to move up — and the timetable below shows exactly where each squad trains."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/join" className="btn btn-primary">Joining &amp; fees</Link>
          <Link href="/training/venues" className="btn btn-onDark">Where we train</Link>
        </div>
      </PageHero>

      {squads.length === 0 ? (
        <Section title="">
          <EmptyState
            icon={<Waves className="h-6 w-6" />}
            title="Timetable coming soon"
            message="Squad details and session times will appear here once they're published."
          />
        </Section>
      ) : (
        <Section eyebrow="The squads" title="Where you'll swim">
          <div className="space-y-5">
            {squads.map((squad) => (
              <article
                key={squad.id}
                id={squad.slug}
                className="card p-6 md:p-8 scroll-mt-header"
              >
                <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-xl">{squad.name}</h2>
                      {squad.hours_guide && (
                        <span className="badge badge-gold">
                          <Clock className="h-3 w-3" aria-hidden />
                          {squad.hours_guide} a week
                        </span>
                      )}
                    </div>
                    {squad.tagline && (
                      <p className="mt-1.5 text-[0.9rem] font-medium text-brand-500">
                        {squad.tagline}
                      </p>
                    )}
                    {squad.description && (
                      <p className="mt-3 text-ink-600 text-[0.94rem]">{squad.description}</p>
                    )}
                  </div>

                  <div>
                    {squad.sessions && squad.sessions.length > 0 ? (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {squad.sessions.map((s) => (
                          <li
                            key={s.id}
                            className="rounded-xl border border-ink-200 bg-ink-50 px-4 py-3"
                          >
                            <p className="flex items-baseline gap-2">
                              <span className="font-[family-name:var(--font-heading)] font-bold text-brand-700 text-[0.8rem] uppercase tracking-wider">
                                {DAY_SHORT[s.day_of_week] ?? ""}
                              </span>
                              <span className="tnum font-semibold text-brand-900">
                                {s.starts_at}–{s.ends_at}
                              </span>
                            </p>
                            <p className="mt-0.5 text-[0.85rem] text-ink-500 flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {s.venue}
                            </p>
                            {s.note && (
                              <p className="mt-1 text-[0.78rem] text-brand-500 font-medium">
                                {s.note}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[0.9rem] text-ink-400 italic">
                        Session times for this squad haven't been published yet.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}

      {venues.length > 0 && (
        <Section eyebrow="Pools" title="Where we train" className="bg-wash">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {venues.map((venue) => (
              <div key={venue.id} className="card p-5">
                <h3 className="text-lg">{venue.name}</h3>
                {venue.address && (
                  <p className="mt-1.5 text-[0.85rem] text-ink-500">{venue.address}</p>
                )}
                {(venue.length_m || venue.lanes) && (
                  <p className="mt-3 badge badge-muted">
                    {[venue.length_m ? `${venue.length_m}m` : null, venue.lanes ? `${venue.lanes} lanes` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {venue.notes && (
                  <p className="mt-3 text-[0.85rem] text-ink-600">{venue.notes}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
