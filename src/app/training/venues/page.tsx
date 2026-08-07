import type { Metadata } from "next";
import { ExternalLink, MapPin } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getVenues } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Where we train",
  description:
    "The pools Carnforth Otters train in — Salt Ayre Leisure Centre, the Salt Ayre training tank, Carnforth and Heysham.",
};

export default async function VenuesPage() {
  const venues = await getVenues();

  return (
    <>
      <PageHero
        breadcrumbs={[
          { href: "/training", label: "Training" },
          { href: "/training/venues", label: "Where we train" },
        ]}
        eyebrow="Training"
        title="Where we train"
        intro="We use four pools across the Lancaster district. Salt Ayre is our main pool and the home of our galas."
      />

      <Section title="">
        {venues.length === 0 ? (
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            title="Venues coming soon"
            message="Pool details and directions will be published here."
          />
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {venues.map((venue) => (
              <article key={venue.id} className="card p-7">
                <h2 className="text-xl">{venue.name}</h2>
                {venue.address && (
                  <p className="mt-2 flex items-start gap-2 text-ink-600 text-[0.94rem]">
                    <MapPin className="h-4 w-4 mt-1 shrink-0 text-brand-400" aria-hidden />
                    <span>
                      {venue.address}
                      {venue.postcode ? `, ${venue.postcode}` : ""}
                    </span>
                  </p>
                )}
                {(venue.length_m || venue.lanes) && (
                  <p className="mt-4">
                    <span className="badge badge-brand">
                      {[
                        venue.length_m ? `${venue.length_m}m pool` : null,
                        venue.lanes ? `${venue.lanes} lanes` : null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                )}
                {venue.notes && <p className="mt-4 text-ink-600 text-[0.94rem]">{venue.notes}</p>}
                {venue.map_url && (
                  <a
                    href={venue.map_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm mt-5"
                  >
                    Directions
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
