import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, ExternalLink } from "lucide-react";
import GalaCard from "@/components/gala-card";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getClubSettings, getGalas, getUpcomingGalas } from "@/lib/queries";
import { galaStatus } from "@/lib/format";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Fixtures & entries",
  description:
    "Upcoming galas, open meets and league fixtures for Carnforth & District Otters ASC, plus how to enter through SwimManager.",
};

export default async function FixturesPage() {
  const [club, upcoming, all] = await Promise.all([
    getClubSettings(),
    getUpcomingGalas(24),
    getGalas({ limit: 12 }),
  ]);

  const recent = all.filter((g) => {
    const status = galaStatus(g);
    return status === "recent" || status === "live";
  });

  return (
    <>
      <PageHero
        breadcrumbs={[
          { href: "/competing", label: "Competing" },
          { href: "/competing/fixtures", label: "Fixtures" },
        ]}
        eyebrow="Competing"
        title="Fixtures & entries"
        intro="Galas we're hosting and meets we're travelling to. Entries and payments go through SwimManager — tick 'Meet Entries Open' in your account to get notified the moment one opens."
      >
        {club.swimManager && (
          <a
            href={club.swimManager}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
          >
            Open SwimManager
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </PageHero>

      <Section eyebrow="Coming up" title="Upcoming fixtures">
        {upcoming.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((gala) => (
              <GalaCard key={gala.id} gala={gala} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="No fixtures listed"
            message="The calendar is confirmed a season at a time. Until it's published here, SwimManager always has the live list of what's open for entry."
            action={
              club.swimManager ? (
                <a
                  href={club.swimManager}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-brand btn-sm"
                >
                  Check SwimManager
                </a>
              ) : undefined
            }
          />
        )}
      </Section>

      {recent.length > 0 && (
        <Section eyebrow="Just been" title="Recent meets" className="bg-wash">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {recent.map((gala) => (
              <GalaCard key={gala.id} gala={gala} />
            ))}
          </div>
        </Section>
      )}

      <Section className="pt-0">
        <div className="grid gap-5 md:grid-cols-2 max-w-4xl">
          <div className="card p-7">
            <h2 className="text-lg">New to galas?</h2>
            <p className="mt-2.5 text-ink-600 text-[0.94rem]">
              Qualifying times, licensed meets, short course versus long course — the jargon takes
              a season to sink in. We've written it all down.
            </p>
            <Link href="/competing/competition-faqs" className="btn btn-ghost btn-sm mt-5">
              Competition FAQs
            </Link>
          </div>
          <div className="card p-7">
            <h2 className="text-lg">On the day</h2>
            <p className="mt-2.5 text-ink-600 text-[0.94rem]">
              What to bring, where to sit, when to report to marshalling and how withdrawals work.
            </p>
            <Link href="/competing/team-protocol" className="btn btn-ghost btn-sm mt-5">
              Team protocol
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
