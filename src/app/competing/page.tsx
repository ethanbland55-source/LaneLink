import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHero, Section } from "@/components/ui";
import { NAV } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Competing",
  description:
    "Fixtures, gala results, live coverage, team protocol and competition FAQs for Carnforth & District Otters ASC.",
};

export default function CompetingPage() {
  const links = NAV.find((g) => g.label === "Competing")?.links ?? [];

  return (
    <>
      <PageHero
        eyebrow="Competing"
        title="Racing with the Otters"
        intro="From a first club time trial to national qualification. Here's where to find what's coming up, what happened, and what to expect on the day."
      />
      <Section title="">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="card card-hover p-7 group flex flex-col">
              <h2 className="text-xl group-hover:text-brand-600 transition-colors">{link.label}</h2>
              {link.description && (
                <p className="mt-2.5 text-ink-600 text-[0.94rem] flex-1">{link.description}</p>
              )}
              <span className="mt-5 inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-brand-700 group-hover:gap-2.5 transition-all">
                Open
                <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </Section>
    </>
  );
}
