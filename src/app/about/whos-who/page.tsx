import type { Metadata } from "next";
import Image from "next/image";
import { Mail, Phone, Users } from "lucide-react";
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

  /**
   * Plenty of volunteers wear two hats — a coach who's also on the committee,
   * a team manager who's also an official. Printing the same card in both
   * places reads like a mistake, so each person has one "home" section where
   * their full card lives, and appears as a compact cross-reference in the
   * others. Nobody goes missing, nothing looks duplicated.
   */
  const homeOf = (p: Person) => p.primary_section ?? p.sections[0] ?? "";

  const cards = new Map<string, Person[]>();
  const alsoHere = new Map<string, Person[]>();

  for (const person of people) {
    const home = homeOf(person);
    if (home) {
      const list = cards.get(home);
      if (list) list.push(person);
      else cards.set(home, [person]);
    }
    for (const section of person.sections) {
      if (section === home) continue;
      const list = alsoHere.get(section);
      if (list) list.push(person);
      else alsoHere.set(section, [person]);
    }
  }

  const populated = PERSON_SECTIONS.filter(
    (s) => (cards.get(s.key)?.length ?? 0) > 0 || (alsoHere.get(s.key)?.length ?? 0) > 0
  );

  return (
    <>
      <PageHero
        breadcrumbs={[{ href: "/about", label: "About" }, { href: "/about/whos-who", label: "Who's Who" }]}
        eyebrow="About the club"
        title="Who's Who"
        intro="Carnforth Otters is run and coached entirely by volunteers. These are the people who make it happen — on poolside, on the gantry and behind the scenes."
      >
        {populated.length > 1 && (
          <nav aria-label="Jump to a group" className="flex flex-wrap gap-2">
            {populated.map((s) => (
              <a key={s.key} href={`#${s.key}`} className="btn btn-onDark btn-sm">
                {s.label}
              </a>
            ))}
          </nav>
        )}
      </PageHero>

      {populated.length === 0 ? (
        <Section title="">
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="Nobody listed yet"
            message="Committee members, coaches, team managers and officials will appear here once they've been added."
          />
        </Section>
      ) : (
        populated.map((section, i) => {
          const primary = cards.get(section.key) ?? [];
          const cross = alsoHere.get(section.key) ?? [];
          return (
            <Section
              key={section.key}
              id={section.key}
              eyebrow={section.eyebrow}
              title={section.label}
              className={i % 2 === 1 ? "bg-wash" : ""}
            >
              {primary.length > 0 && (
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {primary.map((person) => (
                    <li key={person.id} id={`person-${person.id}`} className="scroll-mt-header">
                      <PersonCard person={person} />
                    </li>
                  ))}
                </ul>
              )}

              {cross.length > 0 && (
                <div className={primary.length ? "mt-8" : ""}>
                  <p className="eyebrow mb-3">Also part of this team</p>
                  <ul className="flex flex-wrap gap-2.5">
                    {cross.map((person) => (
                      <li key={`${section.key}-${person.id}`}>
                        <a
                          href={`#person-${person.id}`}
                          className="flex items-center gap-2.5 rounded-full border border-ink-200 bg-white py-1.5 pl-1.5 pr-4 hover:border-brand-300 hover:bg-brand-50 transition-colors"
                        >
                          <Avatar person={person} size={32} />
                          <span className="text-[0.88rem]">
                            <span className="font-semibold text-brand-900">{person.name}</span>
                            {person.roles[0] && (
                              <span className="text-ink-500"> · {person.roles[0]}</span>
                            )}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          );
        })
      )}

      <Section className="pt-0">
        <div className="card p-8 bg-brand-50 border-brand-200 max-w-3xl">
          <h2 className="text-xl">Could you help?</h2>
          <p className="mt-2.5 text-ink-600">
            Every club needs timekeepers, team managers and committee members. No experience
            needed — training is free and the club covers the cost of officials&rsquo;
            qualifications.
          </p>
          <a href="/contact" className="btn btn-brand btn-sm mt-5">Get in touch</a>
        </div>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Avatar({ person, size = 112 }: { person: Person; size?: number }) {
  if (person.photo_url) {
    return (
      <Image
        src={person.photo_url}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-brand-100"
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  return (
    <span
      className="flex items-center justify-center rounded-full bg-brand-700 text-white font-[family-name:var(--font-heading)] font-bold ring-2 ring-brand-100"
      style={{ width: size, height: size, fontSize: size / 3 }}
      aria-hidden
    >
      {initials(person.name)}
    </span>
  );
}

function PersonCard({ person }: { person: Person }) {
  const extraGroups = person.sections.filter(
    (s) => s !== (person.primary_section ?? person.sections[0])
  );

  return (
    <article className="card card-hover p-6 h-full flex flex-col items-center text-center">
      <Avatar person={person} size={112} />

      <h3 className="mt-4 text-lg">{person.name}</h3>

      {person.roles.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap justify-center gap-1.5">
          {person.roles.map((role) => (
            <li key={role} className="badge badge-brand">{role}</li>
          ))}
        </ul>
      )}

      {extraGroups.length > 0 && (
        <p className="mt-2 text-[0.78rem] text-ink-400">
          Also{" "}
          {extraGroups
            .map((key) => PERSON_SECTIONS.find((s) => s.key === key)?.label ?? key)
            .join(" · ")}
        </p>
      )}

      {person.bio && <p className="mt-3.5 text-[0.88rem] text-ink-600">{person.bio}</p>}

      {(person.email || person.phone) && (
        <div className="mt-auto pt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
          {person.email && (
            <a
              href={`mailto:${person.email}`}
              className="inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-brand-600 hover:text-gold-700"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Email
            </a>
          )}
          {person.phone && (
            <a
              href={`tel:${person.phone.replace(/\s+/g, "")}`}
              className="inline-flex items-center gap-1.5 text-[0.85rem] font-medium text-brand-600 hover:text-gold-700"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {person.phone}
            </a>
          )}
        </div>
      )}
    </article>
  );
}
