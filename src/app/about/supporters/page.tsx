import type { Metadata } from "next";
import Image from "next/image";
import { ExternalLink, Heart } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getSponsors } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Supporters",
  description:
    "The businesses, funders and volunteers who support Carnforth & District Otters ASC — and how you can help.",
};

export default async function SupportersPage() {
  const sponsors = await getSponsors();
  const accreditations = sponsors.filter((s) => s.tier === "accreditation");
  const supporters = sponsors.filter((s) => s.tier !== "accreditation");

  return (
    <>
      <PageHero
        breadcrumbs={[
          { href: "/about", label: "About" },
          { href: "/about/supporters", label: "Supporters" },
        ]}
        eyebrow="About"
        title="Supporters & fundraising"
        intro="The club is a non-profit run entirely by volunteers. Pool time is our biggest cost, and these are the people who help us cover it."
      />

      <Section eyebrow="Thank you" title="Our supporters">
        {supporters.length === 0 ? (
          <EmptyState
            icon={<Heart className="h-6 w-6" />}
            title="Supporters coming soon"
            message="The businesses and funders who back the club will be listed here."
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {supporters.map((sponsor) => (
              <article key={sponsor.id} className="card p-6 flex flex-col">
                {sponsor.logo_url && (
                  <Image
                    src={sponsor.logo_url}
                    alt={sponsor.name}
                    width={220}
                    height={90}
                    className="h-16 w-auto object-contain object-left"
                    unoptimized
                  />
                )}
                <h2 className="mt-4 text-lg">{sponsor.name}</h2>
                {sponsor.blurb && (
                  <p className="mt-2 text-[0.9rem] text-ink-600 flex-1">{sponsor.blurb}</p>
                )}
                {sponsor.url && (
                  <a
                    href={sponsor.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-brand-600 hover:text-gold-700"
                  >
                    Visit
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      {accreditations.length > 0 && (
        <Section eyebrow="Accredited" title="Standards we hold" className="bg-wash">
          <ul className="flex flex-wrap gap-6 items-center">
            {accreditations.map((a) => (
              <li key={a.id}>
                {a.logo_url ? (
                  <Image
                    src={a.logo_url}
                    alt={a.name}
                    width={200}
                    height={90}
                    className="h-16 w-auto object-contain"
                    unoptimized
                  />
                ) : (
                  <span className="badge badge-brand">{a.name}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section className="pt-0">
        <div className="card p-8 bg-brand-50 border-brand-200 max-w-3xl">
          <h2 className="text-xl">How you can help</h2>
          <p className="mt-2.5 text-ink-600">
            Shop through easyfundraising and a percentage comes back to the club at no cost to you.
            Businesses can sponsor a gala, a squad or a set of kit. And we always need timekeepers.
          </p>
          <a href="/contact" className="btn btn-brand btn-sm mt-5">Talk to the committee</a>
        </div>
      </Section>
    </>
  );
}
