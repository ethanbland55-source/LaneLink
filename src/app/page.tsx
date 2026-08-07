import Link from "next/link";
import {
  ArrowRight, CalendarDays, FileText, Radio, Timer, Trophy, Users, Waves,
} from "lucide-react";
import GalaCard from "@/components/gala-card";
import { EmptyState, Section, Stat } from "@/components/ui";
import {
  getClubSettings, getLiveGala, getNews, getNewsletters, getSquads, getUpcomingGalas,
} from "@/lib/queries";
import { formatDateRange, formatShortDate } from "@/lib/format";

export const revalidate = 60;

const QUICK_ACTIONS = [
  { href: "/results", label: "Gala results", note: "Every result we've hosted", Icon: Trophy },
  { href: "/training", label: "Squads & times", note: "Who trains when, and where", Icon: Timer },
  { href: "/competing/fixtures", label: "Fixtures & entries", note: "What's coming up", Icon: CalendarDays },
  { href: "/newsletters", label: "Newsletters", note: "Club news, every issue", Icon: FileText },
];

export default async function HomePage() {
  const [club, liveGala, upcoming, news, newsletters, squads] = await Promise.all([
    getClubSettings(),
    getLiveGala(),
    getUpcomingGalas(3),
    getNews(3),
    getNewsletters(1),
    getSquads(),
  ]);

  const latestNewsletter = newsletters[0] ?? null;

  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="bg-deep lane-lines text-white relative overflow-hidden">
        <div className="container-page py-20 md:py-28 relative">
          <div className="max-w-3xl">
            <p className="eyebrow text-gold-400">Lancaster · Est. 1969</p>
            <h1 className="mt-4 text-white text-[clamp(2.3rem,6vw,4rem)]">
              A swimming club built by <span className="text-gold-400">volunteers</span>, for
              swimmers aged 4 to masters.
            </h1>
            <p className="mt-6 text-lg md:text-xl text-brand-100/85 max-w-2xl">
              {club.strapline} Home to a world record holder and a 2012 Olympic finalist — and
              to hundreds of swimmers who just want to get better every week.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/join" className="btn btn-primary">
                Join the club
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              {liveGala ? (
                <Link href="/live" className="btn btn-onDark">
                  <span className="live-dot text-aqua-400" aria-hidden />
                  Live results
                </Link>
              ) : (
                <Link href="/results" className="btn btn-onDark">
                  <Trophy className="h-4 w-4" aria-hidden />
                  Gala results
                </Link>
              )}
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 gap-8 sm:grid-cols-4 max-w-3xl border-t border-white/15 pt-9">
            <Stat value="4–60+" label="Ages we coach" />
            <Stat value="8" label="Squads, Development to Masters" />
            <Stat value="4" label="Pools across the district" />
            <Stat value="100%" label="Volunteer run" />
          </div>
        </div>

        {/* Decorative water edge */}
        <svg
          className="w-full h-12 md:h-16 block text-white"
          viewBox="0 0 1440 60"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M0 34c180-28 300 22 480 10s300-40 480-22 300 40 480 22v16H0Z"
            fill="currentColor"
          />
        </svg>
      </section>

      {/* ------------------------------------------------------- Quick actions */}
      <section className="pt-12 md:pt-14">
        <div className="container-page">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map(({ href, label, note, Icon }) => (
              <Link key={href} href={href} className="card card-hover group p-5 flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 group-hover:bg-brand-100 transition-colors">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-[family-name:var(--font-heading)] font-semibold text-brand-900">
                    {label}
                  </span>
                  <span className="block text-[0.85rem] text-ink-500 mt-0.5">{note}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Fixtures */}
      <Section
        eyebrow="Competing"
        title="What's coming up"
        intro="Galas we're hosting and meets we're travelling to. Entries go through SwimManager."
        action={
          <Link href="/competing/fixtures" className="btn btn-ghost btn-sm">
            All fixtures
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
      >
        {upcoming.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((gala) => (
              <GalaCard key={gala.id} gala={gala} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" />}
            title="No fixtures listed yet"
            message="The next galas and open meets will appear here as soon as the calendar is confirmed. In the meantime, entries and fixtures are always live on SwimManager."
            action={
              club.swimManager ? (
                <a
                  href={club.swimManager}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-brand btn-sm"
                >
                  Open SwimManager
                </a>
              ) : undefined
            }
          />
        )}
      </Section>

      {/* -------------------------------------------------------------- Squads */}
      {squads.length > 0 && (
        <section className="bg-wash py-14 md:py-20">
          <div className="container-page">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-9">
              <div className="max-w-2xl">
                <p className="eyebrow mb-2">Training</p>
                <h2 className="text-[clamp(1.6rem,3.4vw,2.25rem)]">
                  Find the right squad
                </h2>
                <p className="mt-3 text-ink-600">
                  Swimmers move up as their technique and stamina develop. Your coach will tell you
                  when it's time.
                </p>
              </div>
              <Link href="/training" className="btn btn-ghost btn-sm">
                Squad times
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {squads.slice(0, 8).map((squad) => (
                <Link
                  key={squad.id}
                  href={`/training#${squad.slug}`}
                  className="card card-hover p-5 group"
                >
                  <div className="flex items-center gap-2.5">
                    <Waves className="h-4 w-4 text-brand-400" aria-hidden />
                    <span className="text-[0.75rem] uppercase tracking-wider text-ink-400 font-semibold">
                      {squad.hours_guide ?? "Training"}
                    </span>
                  </div>
                  <h3 className="mt-3 text-lg group-hover:text-brand-600 transition-colors">
                    {squad.name}
                  </h3>
                  {squad.tagline && (
                    <p className="mt-1.5 text-[0.88rem] text-ink-500">{squad.tagline}</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------ News & letters */}
      <Section eyebrow="Club" title="Latest from the Otters">
        <div className="grid gap-5 lg:grid-cols-3">
          {news.length > 0 ? (
            news.map((post) => (
              <Link key={post.id} href={`/news/${post.slug}`} className="card card-hover p-6 group">
                <p className="text-[0.78rem] uppercase tracking-wider text-ink-400 font-semibold">
                  {formatShortDate(post.published_at)}
                </p>
                <h3 className="mt-2.5 text-lg group-hover:text-brand-600 transition-colors">
                  {post.title}
                </h3>
                {post.excerpt && (
                  <p className="mt-2 text-[0.92rem] text-ink-600 line-clamp-3">{post.excerpt}</p>
                )}
                <span className="mt-4 inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-brand-700 group-hover:gap-2.5 transition-all">
                  Read more
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            ))
          ) : (
            <div className="lg:col-span-2">
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title="No news posts yet"
                message="Club announcements, gala reports and results round-ups will appear here."
              />
            </div>
          )}

          {/* Newsletter promo always sits alongside the news */}
          <div className="card p-6 bg-deep lane-lines text-white border-transparent flex flex-col">
            <p className="eyebrow text-gold-400">Newsletter</p>
            <h3 className="mt-2.5 text-white text-xl">
              {latestNewsletter ? latestNewsletter.title : "The Otters newsletter"}
            </h3>
            <p className="mt-2.5 text-[0.92rem] text-brand-100/85 flex-1">
              {latestNewsletter?.summary ??
                "Squad news, gala reports, swimmer of the month and everything happening around the club — straight from the committee."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {latestNewsletter && (
                <a
                  href={latestNewsletter.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-sm"
                >
                  Read the latest
                </a>
              )}
              <Link href="/newsletters" className="btn btn-onDark btn-sm">
                All issues
              </Link>
            </div>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------------- CTA */}
      <section className="pb-4">
        <div className="container-page">
          <div className="card overflow-hidden bg-deep lane-lines text-white border-transparent">
            <div className="p-10 md:p-14 grid gap-8 md:grid-cols-[1.6fr_1fr] md:items-center">
              <div>
                <p className="eyebrow text-gold-400">Come and try us</p>
                <h2 className="mt-3 text-white text-[clamp(1.6rem,3.6vw,2.4rem)]">
                  Looking for a club where your child is encouraged, not just entered?
                </h2>
                <p className="mt-4 text-brand-100/85 max-w-xl">
                  Our qualified coaches work to a structured performance programme built for
                  long-term development — whether that ends in an Olympic final or just a better
                  turn. Get in touch and we'll find the right squad.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Link href="/join" className="btn btn-primary">
                  <Users className="h-4 w-4" aria-hidden />
                  Joining &amp; fees
                </Link>
                <Link href="/contact" className="btn btn-onDark">
                  <Radio className="h-4 w-4" aria-hidden />
                  Contact the club
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
