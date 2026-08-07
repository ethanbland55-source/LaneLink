import Link from "next/link";
import type { Metadata } from "next";
import ContentPage from "@/components/content-page";
import { Section } from "@/components/ui";
import { NAV } from "@/lib/nav";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "About the club",
  description:
    "Carnforth & District Otters ASC — a Lancaster based, SwimMark accredited competitive swimming club run entirely by volunteers.",
};

export default function AboutPage() {
  const links = NAV.find((g) => g.label === "About")?.links.filter((l) => l.href !== "/about") ?? [];

  return (
    <ContentPage
      slug="about"
      eyebrow="About"
      fallbackTitle="About the Otters"
      fallbackIntro="A Lancaster based, SwimMark accredited competitive swimming club — and home to a world record holder and a 2012 Olympic finalist."
      fallbackBody={`We are an extremely friendly club with swimmers aged 4 to masters, training to compete at club, regional and national level.

The club is run and coached **entirely by volunteers**, who give their time, knowledge and experience for the benefit of every swimmer in the club.

## What a year looks like

Two main social events, including the Presentation Evening where our long-standing trophies are awarded. Several galas for our younger and older swimmers, plus time trials through the season. A yearly training camp abroad with week-long 50m pool sessions. And Masters sessions for adults who want to keep racing.

## Investing in the club

We have installed a full **electronic timing system**, so our home galas run with accurate, instant timing and live results. We have also moved to an online management system that improves communication, simplifies competition entries and makes payments easier.`}
    >
      <Section eyebrow="More" title="Elsewhere in this section" className="bg-wash">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="card card-hover p-5 group">
              <h3 className="text-lg group-hover:text-brand-600 transition-colors">{link.label}</h3>
              {link.description && (
                <p className="mt-1.5 text-[0.88rem] text-ink-500">{link.description}</p>
              )}
            </Link>
          ))}
        </div>
      </Section>
    </ContentPage>
  );
}
