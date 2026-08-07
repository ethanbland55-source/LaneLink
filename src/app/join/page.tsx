import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, Mail } from "lucide-react";
import ContentPage from "@/components/content-page";
import { Section } from "@/components/ui";
import { getClubSettings } from "@/lib/queries";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Joining & fees",
  description:
    "How to join Carnforth & District Otters ASC — trial sessions, squad placement, membership fees and what's included.",
};

const STEPS = [
  {
    title: "Get in touch",
    body: "Email the club with your child's age and swimming experience. We'll suggest which squad is likely to suit and when to come down.",
  },
  {
    title: "Come for a trial",
    body: "Two free trial sessions, no commitment. The coach will watch technique and stamina and confirm the right squad.",
  },
  {
    title: "Join up",
    body: "Register through SwimManager, which handles membership, meet entries and monthly payments in one place.",
  },
  {
    title: "Swim England registration",
    body: "All competitive swimmers register with Swim England each year. This covers insurance and is what makes race times count for rankings.",
  },
];

export default async function JoinPage() {
  const club = await getClubSettings();

  return (
    <ContentPage
      slug="join"
      eyebrow="Membership"
      fallbackTitle="Joining & fees"
      fallbackIntro="Two free trial sessions, then a squad that matches where your swimmer actually is — not just how old they are."
      fallbackBody={`Swimmers join us from around age 4, once they can swim confidently across the pool. There's no upper limit — our Masters squad runs from 18 to well past 60.

Fees are paid monthly and cover pool hire, coaching and club running costs. Meet entry fees are charged separately, per meet, only when you enter. The club is a registered non-profit run by volunteers — every penny goes back into pool time and coaching.`}
    >
      <Section eyebrow="How it works" title="Four steps to your first session" className="bg-wash">
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-700 text-white font-[family-name:var(--font-heading)] font-bold text-sm">
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg">{step.title}</h3>
              <p className="mt-2 text-[0.9rem] text-ink-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="">
        <div className="grid gap-5 lg:grid-cols-2 max-w-4xl">
          <div className="card p-7">
            <h2 className="text-xl">What's included</h2>
            <ul className="mt-4 space-y-2.5">
              {[
                "Coached pool sessions with qualified ASA/Swim England coaches",
                "Land training for the senior squads",
                "Club galas and internal time trials",
                "Team manager support at away meets",
                "Access to the club's electronic timing and live results",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[0.94rem] text-ink-600">
                  <CheckCircle2 className="h-4.5 w-4.5 mt-0.5 shrink-0 text-brand-400" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-7 bg-deep lane-lines text-white border-transparent flex flex-col">
            <h2 className="text-white text-xl">Ready to try us?</h2>
            <p className="mt-2.5 text-brand-100/85 text-[0.94rem] flex-1">
              Tell us your swimmer's age and roughly what they can do, and we'll point you at the
              right session. No pressure, no sales pitch.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <a href={`mailto:${club.email}`} className="btn btn-primary btn-sm">
                <Mail className="h-4 w-4" aria-hidden />
                Email the club
              </a>
              <Link href="/training" className="btn btn-onDark btn-sm">
                Squad times
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </ContentPage>
  );
}
