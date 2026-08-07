import type { Metadata } from "next";
import ContentPage from "@/components/content-page";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Team protocol",
  description:
    "What's expected of swimmers, parents and team managers at a Carnforth Otters gala — arrival, marshalling, poolside access and withdrawals.",
};

export default function TeamProtocolPage() {
  return (
    <ContentPage
      slug="team-protocol"
      eyebrow="Competing"
      breadcrumbs={[
        { href: "/competing", label: "Competing" },
        { href: "/competing/team-protocol", label: "Team protocol" },
      ]}
      fallbackTitle="Team protocol"
      fallbackIntro="What is expected of swimmers, parents and team managers at a gala."
      fallbackBody={`## Before the gala

Arrive in good time for warm-up. Team kit should be worn poolside. Swimmers report to the team manager on arrival and stay in the team area unless racing or warming down.

## During the gala

Swimmers report to marshalling when their event is called. Parents stay in the spectator area — poolside is for swimmers, coaches, team managers and licensed officials only.

## Withdrawals

If a swimmer cannot race, tell the team manager as early as possible so the withdrawal can be processed before the session starts.`}
    />
  );
}
