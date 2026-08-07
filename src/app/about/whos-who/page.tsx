import type { Metadata } from "next";
import Image from "next/image";
import { Mail, Users } from "lucide-react";
import { EmptyState, PageHero, Section } from "@/components/ui";
import { getPeople } from "@/lib/queries";
import { PERSON_SECTIONS, type Person } from "@/lib/types";
import { initials } from "@/lib/format";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Who's Who",
  description:
    "The committee, coaches, team managers and officials who run Carnforth & District Otters ASC.",
};

export default async function WhosWhoPage() {
  const people = await getPeople();

  const bySection = new Map<string, Person[]>();
  for (const person of people) {
    for (const section of person.sections) {
      const list = bySection.get(section);
      if (list) list.push(person);
      else bySection.set(section, [person]);
    }
  }
  const populated = PERSON_SECTIONS.filter((s) => (bySection.get(s.key)?.length ?? 0) > 0);

  return (
    <>
      <PageHero
        breadcrumbs={[{ href: "/about", label: "About" }, { href: "/about/whos-who", label: "Who's Who" }]}
        eyebrow="About the club"
        title="Who's Who"
        intro="Carnforth Otters is run and coached entirely by volunteers. These are the people who make it happen — on poolside, on the gantry and behind the scenes."
      />

      {populated.length === 0 ? (
        <Section title="">
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Nobody listed yet"
            message="Committee members, coaches, team managers and officials will appear here once they've been added."
          />
        </Section>
      ) : (
        populated.map((section, i) => (
          <Section
            key={section.key}
            id={section.key}
            eyebrow={section.eyebrow}
            title={section.label}
            className={i % 2 === 1 ? "bg-wash" : ""}
          >
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {(bySection.get(section.key) ?? []).map((person) => (
                <li key={`${section.key}-${person.id}`}>
                  <PersonCard person={person} />
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}

      <Section className="pt-0">
        <div className="card p-8 bg-brand-50 border-brand-200 max-w-3xl">
          <h2 className="text-xl">Could you help?</h2>
          <p className="mt-2.5 text-ink-600">
            Every club needs timekeepers, team managers and committee members. No experience
            needed — training is free and the club covers the cost of officials' qualifications.
          </p>
          <a href="/contact" className="btn btn-brand btn-sm mt-5">Get in touch</a>
        </div>
      </Section>
    </>
  );
}

function PersonCard({ person }: { person: Person }) {
  return (
    <article className="card card-hover p-6 h-full flex flex-col items-center text-center">
      {person.photo_url ? (
        <Image
          src={person.photo_url}
          alt=""
          width={112}
          height={112}
          className="h-28 w-28 rounded-full object-cover ring-4 ring-brand-50"
          unoptimized
        />
      ) : (
        <span
          className="flex h-28 w-28 items-center justify-center rounded-full bg-brand-700 text-white font-[family-name:var(--font-heading)] font-bold text-2xl ring-4 ring-brand-50"
          aria-hidden
        >
          {initials(person.name)}
        </span>
      )}

      <h3 className="mt-4 text-lg">{person.name}</h3>

      {person.roles.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap justify-center gap-1.5">
          {person.roles.map((role) => (
            <li key={role} className="badge badge-brand">{role}</li>
          ))}
        </ul>
      )}

      {person.bio && <p className="mt-3.5 text-[0.88rem] text-ink-600">{person.bio}</p>}

      {person.email && (
        <a
          href={`mailto:${person.email}`}
          className="mt-auto pt-4 inline-flex items-center gap-2 text-[0.85rem] font-medium text-brand-600 hover:text-gold-700"
        >
          <Mail className="h-3.5 w-3.5" aria-hidden />
          Email
        </a>
      )}
    </article>
  );
}
