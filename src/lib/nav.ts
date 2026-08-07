export type NavLink = { href: string; label: string; description?: string };
export type NavGroup = { label: string; href: string; links: NavLink[] };

/** Single source of truth for navigation — header, footer and sitemap all read this. */
export const NAV: NavGroup[] = [
  {
    label: "About",
    href: "/about",
    links: [
      { href: "/about", label: "About the club", description: "Who we are and how the club works" },
      { href: "/about/whos-who", label: "Who's Who", description: "Committee, coaches, team managers and officials" },
      { href: "/about/policies", label: "Policies & safeguarding", description: "Wavepower, welfare and club documents" },
      { href: "/about/supporters", label: "Supporters", description: "The people and businesses backing us" },
      { href: "/contact", label: "Contact us", description: "Get in touch with the club" },
    ],
  },
  {
    label: "Training",
    href: "/training",
    links: [
      { href: "/training", label: "Squads & times", description: "Every squad and its weekly timetable" },
      { href: "/training/venues", label: "Where we train", description: "Salt Ayre, Carnforth and Heysham" },
      { href: "/join", label: "Joining & fees", description: "How to join and what it costs" },
    ],
  },
  {
    label: "Competing",
    href: "/competing",
    links: [
      { href: "/competing/fixtures", label: "Fixtures & entries", description: "What's coming up and how to enter" },
      { href: "/results", label: "Results & galas", description: "Full results from every gala we host" },
      { href: "/live", label: "Live now", description: "Results as they happen on gala day" },
      { href: "/competing/team-protocol", label: "Team protocol", description: "What to expect at a gala" },
      { href: "/competing/competition-faqs", label: "Competition FAQs", description: "New to galas? Start here" },
    ],
  },
  { label: "Newsletters", href: "/newsletters", links: [] },
  { label: "News", href: "/news", links: [] },
];

export const FOOTER_EXTRA: NavLink[] = [
  { href: "/results", label: "Gala results archive" },
  { href: "/about/policies", label: "Policies & safeguarding" },
  { href: "/privacy", label: "Privacy & data protection" },
  { href: "/admin", label: "Club admin" },
];
