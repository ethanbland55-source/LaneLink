import Link from "next/link";
import type { Metadata } from "next";
import { Facebook, Mail, MapPin, Users, Youtube } from "lucide-react";
import { PageHero, Section } from "@/components/ui";
import { getClubSettings, getVenues } from "@/lib/queries";
import { CONTACT_ROLES } from "@/lib/types";

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

      <Section eyebrow="Email" title="Who to write to">
        <p className="text-ink-600 mb-7 max-w-2xl">
          The club uses role addresses rather than personal ones, so your message reaches whoever
          currently holds the job — even if the person has changed since you last got in touch.
        </p>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mb-10">
          {CONTACT_ROLES.map((role) => {
            const address = club[role.key] as string | undefined;
            if (!address) return null;
            return (
              <li key={role.key}>
                <a
                  href={`mailto:${address}`}
                  className="card card-hover group flex h-full flex-col p-5"
                >
                  <span className="flex items-center gap-2.5">
                    <Mail className="h-4 w-4 text-brand-400" aria-hidden />
                    <span className="font-[family-name:var(--font-heading)] font-semibold text-brand-900">
                      {role.label}
                    </span>
                  </span>
                  <span className="mt-1.5 text-[0.85rem] text-ink-500 flex-1">{role.note}</span>
                  <span className="mt-3 text-[0.85rem] font-medium text-brand-600 group-hover:text-gold-700 break-all">
                    {address}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 max-w-5xl">
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
