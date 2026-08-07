import type { Metadata } from "next";
import ContentPage from "@/components/content-page";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Competition FAQs",
  description:
    "Qualifying times, licensed meets, short course versus long course and what to pack — the questions new gala families ask most.",
};

export default function CompetitionFaqsPage() {
  return (
    <ContentPage
      slug="competition-faqs"
      eyebrow="Competing"
      breadcrumbs={[
        { href: "/competing", label: "Competing" },
        { href: "/competing/competition-faqs", label: "FAQs" },
      ]}
      fallbackTitle="Competition FAQs"
      fallbackIntro="The questions new gala families ask most often."
      fallbackBody={`## What do the times on the entry form mean?

Most open meets have qualifying times — a swimmer must be faster than the slower cut and slower than the faster cut. Your coach will tell you which meets to enter.

## What is a licensed meet?

Licensed meets (Levels 1–4) produce times that count for rankings and for qualification to county, regional and national championships. Unlicensed meets are for racing experience only.

## What is short course and long course?

Short course is a 25m pool, long course is 50m. Times are not directly comparable — rankings list them separately.

## What should we bring?

Two pairs of goggles, club hat, club kit, a large towel, drink and snacks, and something to sit on. Galas are long days.`}
    />
  );
}
