import { notFound } from "next/navigation";
import type { Metadata } from "next";
import GalaCard from "@/components/gala-card";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getGalasBySeries, getSeries } from "@/lib/queries";
import { Trophy } from "lucide-react";

export const revalidate = 300;

export async function generateStaticParams() {
  const series = await getSeries();
  return series.map((s) => ({ series: s.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ series: string }> }
): Promise<Metadata> {
  const { series: slug } = await params;
  const { series } = await getGalasBySeries(slug);
  if (!series) return { title: "Results" };
  return {
    title: `${series.name} results`,
    description: series.blurb ?? `Every ${series.name} hosted by Carnforth Otters, archived by year.`,
  };
}

export default async function SeriesPage({ params }: { params: Promise<{ series: string }> }) {
  const { series: slug } = await params;
  const { series, galas } = await getGalasBySeries(slug);
  if (!series) notFound();

  const byYear = new Map<number, typeof galas>();
  for (const gala of galas) {
    const year = gala.edition_year ?? Number(gala.start_date?.slice(0, 4)) ?? 0;
    const list = byYear.get(year);
    if (list) list.push(gala);
    else byYear.set(year, [gala]);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  return (
    <>
      <PageHero
        breadcrumbs={[
          { href: "/results", label: "Results" },
          { href: `/results/series/${series.slug}`, label: series.name },
        ]}
        eyebrow={`${galas.length} ${galas.length === 1 ? "edition" : "editions"} archived`}
        title={series.name}
        intro={series.blurb}
      />

      {galas.length === 0 ? (
        <Section title="">
          <EmptyState
            icon={<Trophy className="h-6 w-6" />}
            title="Nothing archived yet"
            message={`Results from the ${series.name} will be published here after the first one has been run.`}
          />
        </Section>
      ) : (
        years.map((year) => (
          <Section key={year} title={String(year)} className="py-10">
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {(byYear.get(year) ?? []).map((gala) => (
                <GalaCard key={gala.id} gala={gala} showSeries={false} />
              ))}
            </div>
          </Section>
        ))
      )}
    </>
  );
}
