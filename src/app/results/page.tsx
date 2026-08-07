import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Radio, Trophy } from "lucide-react";
import GalaCard from "@/components/gala-card";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getGalas, getLiveGala, getSeries } from "@/lib/queries";
import { formatDateRange } from "@/lib/format";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Gala results",
  description:
    "Full results from every gala hosted by Carnforth & District Otters ASC — Winter Gala, Summer Gala, Club Championships and time trials, archived by year.",
};

export default async function ResultsIndexPage() {
  const [series, galas, liveGala] = await Promise.all([getSeries(), getGalas(), getLiveGala()]);

  const bySeries = new Map<string, typeof galas>();
  const unfiled: typeof galas = [];
  for (const gala of galas) {
    if (!gala.series_id) { unfiled.push(gala); continue; }
    const list = bySeries.get(gala.series_id);
    if (list) list.push(gala);
    else bySeries.set(gala.series_id, [gala]);
  }

  const populated = series.filter((s) => (bySeries.get(s.id)?.length ?? 0) > 0);

  return (
    <>
      <PageHero
        eyebrow="Competing"
        title="Gala results"
        intro="Every gala we host, archived permanently. Each competition keeps its own area — so last winter's results stay exactly where you left them when the summer gala starts."
      >
        {liveGala && (
          <Link href="/live" className="btn btn-primary">
            <span className="live-dot text-brand-950" aria-hidden />
            {liveGala.name} is live now
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </PageHero>

      {populated.length === 0 && unfiled.length === 0 ? (
        <Section title="">
          <EmptyState
            icon={<Trophy className="h-6 w-6" />}
            title="No results published yet"
            message="Once a gala has been run and the results file uploaded, every session and event will appear here — with splits, club filters and a medal table."
            action={
              <Link href="/competing/fixtures" className="btn btn-brand btn-sm">
                See upcoming fixtures
              </Link>
            }
          />
        </Section>
      ) : (
        <>
          {populated.map((s) => {
            const list = bySeries.get(s.id) ?? [];
            const [latest, ...older] = list;
            return (
              <Section
                key={s.id}
                id={s.slug}
                eyebrow={`${list.length} ${list.length === 1 ? "edition" : "editions"}`}
                title={s.name}
                intro={s.blurb ?? undefined}
                action={
                  older.length > 0 ? (
                    <Link href={`/results/series/${s.slug}`} className="btn btn-ghost btn-sm">
                      All {s.name.toLowerCase()} results
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  ) : undefined
                }
              >
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {list.slice(0, 3).map((gala) => (
                    <GalaCard key={gala.id} gala={gala} showSeries={false} />
                  ))}
                </div>

                {older.length > 2 && (
                  <div className="mt-6 card p-5">
                    <p className="eyebrow mb-3">Earlier editions</p>
                    <ul className="flex flex-wrap gap-2">
                      {older.slice(2).map((gala) => (
                        <li key={gala.id}>
                          <Link
                            href={`/results/${gala.slug}`}
                            className="inline-flex items-center gap-2 rounded-full border border-ink-200 px-3.5 py-1.5 text-[0.85rem] text-ink-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 transition-colors"
                          >
                            <span className="font-semibold">{gala.edition_year ?? ""}</span>
                            <span className="text-ink-400">
                              {formatDateRange(gala.start_date, gala.end_date)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>
            );
          })}

          {unfiled.length > 0 && (
            <Section eyebrow="Other" title="Other meets">
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {unfiled.map((gala) => (
                  <GalaCard key={gala.id} gala={gala} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <Section className="pt-0">
        <div className="card p-8 md:p-10 bg-brand-50 border-brand-200">
          <div className="flex flex-col md:flex-row md:items-center gap-6 justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow mb-2">On gala day</p>
              <h2 className="text-xl md:text-2xl">Results go up session by session</h2>
              <p className="mt-2.5 text-ink-600">
                Heat sheets appear before each session and results are published as soon as each
                event is confirmed by the referee. Refresh the live page rather than waiting for a
                results sheet on the wall.
              </p>
            </div>
            <Link href="/live" className="btn btn-brand shrink-0">
              <Radio className="h-4 w-4" aria-hidden />
              Live page
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
