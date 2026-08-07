import type { Metadata } from "next";
import ContentPage from "@/components/content-page";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Privacy & data protection",
  description: "How Carnforth & District Otters ASC handles personal data.",
};

export default function PrivacyPage() {
  return (
    <ContentPage
      slug="privacy"
      eyebrow="Legal"
      fallbackTitle="Privacy & data protection"
      fallbackIntro="What we collect, why we collect it, and what we do with it."
      fallbackBody={`## What we hold

For members we hold the details needed to run the club: name, date of birth, contact details, Swim England registration number, emergency contact and any medical information you choose to share with the coaches.

## Race results

Results from licensed meets are public by their nature. Swimmer name, age, club and time appear on this website, on Swim England rankings and on the results systems of any meet we attend. This is a condition of competitive swimming and cannot be opted out of while competing.

## Photography

We ask for photography consent when you join. Where consent is not given, we will not publish images of that swimmer. Tell us at any time if you change your mind.

## Who we share data with

Swim England (registration and rankings), our online membership system, and the meet organisers of any competition entered. We never sell data or pass it to advertisers.

## Your rights

You can ask to see, correct or delete the data we hold. Email the club and the committee will respond within one month.

## Cookies

This website sets no advertising or tracking cookies. The only data stored in your browser is what's needed for a club administrator to stay signed in.`}
    />
  );
}
