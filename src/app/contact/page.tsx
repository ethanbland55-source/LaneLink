import Link from "next/link";
import type { Metadata } from "next";
import { Facebook, Mail, MapPin, Users, Youtube } from "lucide-react";
import { PageHero, Section } from "@/components/ui";
import { getClubSettings, getVenues } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Contact us",
  description: "How to get in touch with Carnforth & District Otters ASC.",
};

export default async function ContactPage() {
  const [club, venues] = await Promise.all([getClubSettings(), getVenues()]);
  const main = venues[0] ?? null;

  return (
    <>
      <PageHero
        breadcrumbs={[{ href: "/about", label: "About" }, { href: "/contact", label: "Contact" }]}
        eyebrow="Get in touch"
        title="Contact the club"
        intro="The quickest way to reach us is email — the committee checks it daily. For anything on gala day, find a team manager poolside."
      />

      <Section title="">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 max-w-5xl">
          <div className="card p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Mail className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg">Email</h2>
            <p className="mt-2 text-ink-600 text-[0.94rem]">
              General enquiries, joining and anything for the committee.
            </p>
            <a
              href={`mailto:${club.email}`}
              className="mt-4 inline-block font-semibold text-brand-600 hover:text-gold-700 break-all"
            >
              {club.email}
            </a>
          </div>

          {main && (
            <div className="card p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <MapPin className="h-5 w-5" aria-hidden />
              </span>
              <h2 className="mt-4 text-lg">Find us</h2>
              <p className="mt-2 text-ink-600 text-[0.94rem]">
                Our main pool and the home of our galas.
              </p>
              <p className="mt-4 font-semibold text-brand-900">{main.name}</p>
              {main.address && <p className="text-[0.9rem] text-ink-500">{main.address}</p>}
              <Link href="/training/venues" className="btn btn-ghost btn-sm mt-4">
                All venues
              </Link>
            </div>
          )}

          <div className="card p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Users className="h-5 w-5" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg">Who to ask</h2>
            <p className="mt-2 text-ink-600 text-[0.94rem]">
              Welfare, coaching, team management and committee roles are all listed with contact
              details where they're published.
            </p>
            <Link href="/about/whos-who" className="btn btn-ghost btn-sm mt-4">
              Who's Who
            </Link>
          </div>
        </div>

        <div className="mt-8 card p-7 max-w-5xl">
          <h2 className="text-lg">Follow the club</h2>
          <p className="mt-2 text-ink-600 text-[0.94rem]">
            Gala photos, results round-ups and last-minute session changes.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {club.facebook && (
              <a
                href={club.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <Facebook className="h-4 w-4" aria-hidden />
                Facebook
              </a>
            )}
            {club.youtube && (
              <a
                href={club.youtube}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                <Youtube className="h-4 w-4" aria-hidden />
                YouTube
              </a>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
