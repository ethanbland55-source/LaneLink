/**
 * Seed the club's real content — committee, coaches, training times, venues,
 * squads and policy documents — taken from the existing carnforthotters.co.uk.
 *
 *   npm run seed
 *
 * Safe to re-run: everything is matched on a natural key and updated in place,
 * so nothing is duplicated and hand edits to other fields survive.
 *
 * Source: the club's own public pages (committee, coaches, policies, the
 * training timetable on the home page), read in August 2026.
 */

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const env: Record<string, string> = {};
for (const line of (await readFile(new URL("../.env", import.meta.url), "utf8")).split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const log = (m: string) => console.log(`  ${m}`);

/* -------------------------------------------------------------------------- */
/* People — committee and coaches                                              */
/*                                                                             */
/* Several people do more than one job. `primary_section` decides where their  */
/* full card appears; they're cross-referenced in the other groups.            */
/* -------------------------------------------------------------------------- */

type Seed = {
  name: string;
  roles: string[];
  sections: string[];
  primary: string;
  email?: string;
  order: number;
};

const PEOPLE: Seed[] = [
  // --- Committee, in the order the club lists them ---
  { name: "Nicola Woodruff", roles: ["Chair of Committee"], sections: ["committee"], primary: "committee", email: "chair@carnforthotters.co.uk", order: 1 },
  { name: "Sophie Casson", roles: ["Club President"], sections: ["committee"], primary: "committee", order: 2 },
  { name: "Rhian Spence", roles: ["Secretary"], sections: ["committee"], primary: "committee", email: "secretary@carnforthotters.co.uk", order: 3 },
  { name: "Dakshina De Silva", roles: ["Treasurer"], sections: ["committee"], primary: "committee", order: 4 },
  { name: "Suzanna Peart", roles: ["Club Membership & Badges"], sections: ["committee"], primary: "committee", email: "membership@carnforthotters.co.uk", order: 5 },
  { name: "Claire Wilcox", roles: ["Welfare Officer", "Child Protection"], sections: ["committee"], primary: "committee", email: "welfare@carnforthotters.co.uk", order: 6 },
  { name: "Chris O'Neill", roles: ["Welfare Officer", "Child Protection"], sections: ["committee"], primary: "committee", email: "welfare@carnforthotters.co.uk", order: 7 },
  { name: "Karen Elliott", roles: ["Data Administrator"], sections: ["committee"], primary: "committee", order: 8 },
  { name: "Janet Cadman", roles: ["Competition Secretary"], sections: ["committee"], primary: "committee", email: "competitions@carnforthotters.co.uk", order: 9 },
  { name: "Mike Adamson", roles: ["Fundraising"], sections: ["committee"], primary: "committee", order: 10 },
  { name: "John Hardiman", roles: ["Website", "Club Galas"], sections: ["committee"], primary: "committee", email: "website@carnforthotters.co.uk", order: 11 },
  { name: "Ange Evans", roles: ["Club Shop"], sections: ["committee"], primary: "committee", order: 12 },
  { name: "Nikki Hardiman", roles: ["Social Media"], sections: ["committee"], primary: "committee", order: 13 },

  // --- Coaching team. Noel sits on the committee too, so he's cross-listed. ---
  { name: "Noel Evans", roles: ["Head Coach", "Level 2", "SwimMark Coordinator"], sections: ["coaches", "committee"], primary: "coaches", order: 1 },
  { name: "Stuart Horton", roles: ["Deputy Head Coach", "Level 2"], sections: ["coaches"], primary: "coaches", order: 2 },
  { name: "Kate Oldfield", roles: ["Junior Squad", "Level 2"], sections: ["coaches"], primary: "coaches", order: 3 },
  { name: "Adam Wilcox", roles: ["Level 2"], sections: ["coaches"], primary: "coaches", order: 4 },
  { name: "Ian Gibson", roles: ["Level 2"], sections: ["coaches"], primary: "coaches", order: 5 },
  { name: "Christine Johnson", roles: ["Level 2"], sections: ["coaches"], primary: "coaches", order: 6 },
  { name: "Louis Puttick", roles: ["Level 2"], sections: ["coaches"], primary: "coaches", order: 7 },
  { name: "Chris Henderson", roles: ["Junior Squad", "Level 1"], sections: ["coaches"], primary: "coaches", order: 8 },
  { name: "Ronnie Barker", roles: ["T Squad", "Level 1"], sections: ["coaches"], primary: "coaches", order: 9 },
  { name: "Phil Austin", roles: ["T Squad", "Level 1"], sections: ["coaches"], primary: "coaches", order: 10 },
  { name: "Wendy Kelleher", roles: ["Level 1"], sections: ["coaches"], primary: "coaches", order: 11 },
  { name: "John McGartland", roles: ["Level 1"], sections: ["coaches"], primary: "coaches", order: 12 },
  { name: "Jessica McMillan", roles: ["Level 1"], sections: ["coaches"], primary: "coaches", order: 13 },
];

/* -------------------------------------------------------------------------- */
/* Squads and the weekly timetable                                             */
/* -------------------------------------------------------------------------- */

const SQUADS = [
  { slug: "development", name: "Development", tagline: "First steps into club swimming", hours_guide: "1-1.5 hrs",
    description: "Entry level for young swimmers, moving from two sessions a week to three. Lessons follow the National Plan for Teaching Swimming.", sort_order: 1 },
  { slug: "cubs", name: "Cubs", tagline: "Learning to train", hours_guide: "1-1.5 hrs",
    description: "Entry level for young swimmers building towards full club training — two sessions a week moving to three.", sort_order: 2 },
  { slug: "otters-1", name: "Otters 1", tagline: "Ready for full lengths", hours_guide: "2.5-3 hrs",
    description: "Almost ready for the main 25m pool, and ready to train full lengths at Carnforth.", sort_order: 3 },
  { slug: "otters-2", name: "Otters 2", tagline: "Building stroke range", hours_guide: "2.5-3 hrs",
    description: "Developing all four strokes and racing skills ahead of the Junior squads.", sort_order: 4 },
  { slug: "j-squad", name: "J-Squad", tagline: "Junior competitive squad", hours_guide: "4-6 hrs",
    description: "Junior Lower have learned basic stroke technique and are ready to swim 25m. Junior Middle ranges from seven-year-olds up to Cumbrian League age group. Junior Top train four to six hours a week.", sort_order: 5 },
  { slug: "t-squad", name: "T-Squad", tagline: "Senior performance squad", hours_guide: "6-7.5+ hrs",
    description: "Older swimmers in the later sessions, with land training alongside pool work. Lower group six to seven and a half hours a week, upper group more. Training time is set by the coach.", sort_order: 6 },
  { slug: "masters", name: "Masters", tagline: "Adult swimming", hours_guide: "2-3 hrs",
    description: "Adults training to take their best times to the next level, from fitness swimmers to Masters competitors.", sort_order: 7 },
];

// day: 1 = Monday … 7 = Sunday
const SESSIONS: Record<string, [number, string, string, string, string?][]> = {
  development: [
    [5, "Carnforth", "19:00", "20:00"],
    [6, "Salt Ayre Tank", "16:00", "17:00"],
    [7, "Salt Ayre Tank", "08:00", "09:30"],
  ],
  cubs: [
    [1, "Salt Ayre Tank", "19:00", "19:30"],
    [3, "Salt Ayre Tank", "19:00", "19:30"],
    [6, "Salt Ayre Tank", "16:00", "16:45"],
  ],
  "otters-1": [
    [1, "Salt Ayre Tank", "19:30", "20:15"],
    [3, "Salt Ayre Tank", "19:30", "20:15"],
    [5, "Carnforth", "19:00", "20:00"],
    [6, "Salt Ayre", "16:00", "17:00"],
  ],
  "otters-2": [
    [1, "Salt Ayre Tank", "19:30", "20:15"],
    [3, "Salt Ayre Tank", "19:30", "20:15"],
    [5, "Carnforth", "19:00", "20:00"],
    [6, "Salt Ayre", "16:00", "17:00"],
  ],
  "j-squad": [
    [1, "Salt Ayre", "19:00", "20:00"],
    [3, "Salt Ayre", "19:00", "20:00"],
    [5, "Carnforth", "19:00", "20:00", "J1 only"],
    [5, "Heysham", "19:00", "20:00", "J2, J3 and J4"],
    [6, "Salt Ayre", "16:00", "17:00"],
    [7, "Salt Ayre Tank", "08:00", "09:30"],
  ],
  "t-squad": [
    [1, "Salt Ayre", "20:00", "21:30", "Land training 19:15–19:45"],
    [3, "Salt Ayre", "20:00", "21:30", "Land training 19:15–19:45"],
    [4, "Heysham", "19:00", "21:00", "Invite only"],
    [5, "Heysham", "20:00", "21:30"],
    [6, "Salt Ayre", "17:00", "18:30"],
    [7, "Salt Ayre", "08:00", "09:30"],
  ],
  masters: [
    [1, "Salt Ayre", "20:20", "21:20"],
    [3, "Salt Ayre", "20:20", "21:20"],
    [6, "Salt Ayre", "17:00", "18:20"],
  ],
};

/* -------------------------------------------------------------------------- */
/* Policy documents                                                            */
/*                                                                             */
/* The club lists these on its policies page. Only the committee code of       */
/* conduct has a public URL we can carry over; the rest need the PDFs          */
/* uploading through the admin area, so they're seeded unpublished as a        */
/* checklist rather than as dead links.                                        */
/* -------------------------------------------------------------------------- */

const DOCUMENTS = [
  { title: "Code of Conduct — Committee Members, Officials and Volunteers", category: "codes-of-conduct",
    file_url: "http://carnforthotters.co.uk/otters2016/wp-content/uploads/2018/03/Code-of-Conduct-Committee-Members-Offiials-Volunteers.pdf",
    published: true, sort_order: 1 },
  { title: "Club Rules", category: "governance", file_url: "", published: false, sort_order: 2 },
  { title: "Club Constitution", category: "governance", file_url: "", published: false, sort_order: 3 },
  { title: "Anti-Bullying Policy", category: "safeguarding", file_url: "", published: false, sort_order: 4 },
  { title: "Changing Room Policy", category: "safeguarding", file_url: "", published: false, sort_order: 5 },
  { title: "Wavepower Safeguarding Policy", category: "safeguarding", file_url: "", published: false, sort_order: 6 },
  { title: "Behaviour Policy", category: "safeguarding", file_url: "", published: false, sort_order: 7 },
  { title: "Equity Policy", category: "governance", file_url: "", published: false, sort_order: 8 },
  { title: "Data Protection Statement", category: "data-protection", file_url: "", published: false, sort_order: 9 },
  { title: "Privacy Notice", category: "data-protection", file_url: "", published: false, sort_order: 10 },
];

/* -------------------------------------------------------------------------- */
/* Supporters and accreditations                                               */
/*                                                                             */
/* Logos still point at the old host. That's fine while the domain hasn't      */
/* moved (next.config.ts allows it as an image source), but re-upload them     */
/* through the admin area before the DNS switch or they'll break.              */
/* -------------------------------------------------------------------------- */

const OLD = "https://carnforthotters.co.uk";

const SPONSORS = [
  { name: "Swim England Affiliated", tier: "accreditation", sort_order: 1,
    url: "https://www.swimming.org/swimengland/",
    logo_url: `${OLD}/otters2016/wp-content/uploads/2017/04/swim-england-affiliated.jpg`,
    blurb: null },
  { name: "SwimMark Essential Club", tier: "accreditation", sort_order: 2,
    url: "https://www.swimming.org/swimengland/swimmark/",
    logo_url: `${OLD}/wp-content/uploads/2018/01/SwimMark-Essential-Club-300x130.jpg`,
    blurb: null },
  { name: "Wavepower Safeguarding", tier: "accreditation", sort_order: 3,
    url: "https://www.swimming.org/swimengland/wavepower-child-safeguarding-for-clubs/",
    logo_url: `${OLD}/wp-content/uploads/2024/03/lAKs-300x162.jpg`,
    blurb: null },

  { name: "Oglethorpe Sturton & Gillibrand", tier: "headline", sort_order: 1,
    url: `${OLD}/about-us/our-supporters/`,
    logo_url: `${OLD}/otters2016/wp-content/uploads/2017/06/oglethorpe-sturton-gillibrandx1.png`,
    blurb: "Long-standing club supporter." },
  { name: "Lancashire Community Foundation", tier: "headline", sort_order: 2,
    url: "https://lancsfoundation.org.uk/",
    logo_url: "https://lancsfoundation.org.uk/uploadedfiles/images/CFL%20Full%20Logo%20PNG.png",
    blurb: "Grant funding towards club equipment and pool time." },
  { name: "ProSwimwear", tier: "supporter", sort_order: 3,
    url: "http://www.proswimwear.co.uk/swim-clubs/swim-clubs-c/carnforth-otters-amateur-swimming-club.html/?c=b6ab3b",
    logo_url: `${OLD}/otters2016/wp-content/uploads/2016/02/proswimwearClick.png`,
    blurb: "10% off for Carnforth Otters members through the club shop link." },
  { name: "easyfundraising", tier: "supporter", sort_order: 4,
    url: "https://www.easyfundraising.org.uk/causes/carnforthottersswimclub/",
    logo_url: `${OLD}/otters2016/wp-content/uploads/2019/04/easyfundraising.jpg`,
    blurb: "Shop online through easyfundraising and a percentage comes back to the club, at no cost to you." },
  { name: "Allens of Kingsbury", tier: "supporter", sort_order: 5,
    url: null,
    logo_url: null,
    blurb: "10% off year round with promo code CARNFORTH10." },
];

/* -------------------------------------------------------------------------- */
/* Page copy carried over                                                      */
/* -------------------------------------------------------------------------- */

const PAGES = [
  {
    slug: "policies",
    title: "Policies & safeguarding",
    intro: "The club operates under Swim England rules and maintains policies covering every area of governance.",
    body: `We recommend every member reads these documents and keeps a copy. They set out how the club is run and the principles that coaches, committee members, poolside helpers, swimmers and parents all agree to.

## Safeguarding

Carnforth & District Otters ASC bases its child protection policies on the Swim England **Wavepower** standard.

If you have any concern about the welfare of a child at the club, contact our Welfare Officers — Claire Wilcox and Chris O'Neill — on [welfare@carnforthotters.co.uk](mailto:welfare@carnforthotters.co.uk). Concerns are taken seriously and handled confidentially.

## Swimline

Swim England and the NSPCC operate **Swimline**, a confidential freephone number for anyone in the sport, adult or child, who believes the welfare of someone under 18 is at risk — whether that's neglect, abuse, bullying or anything else worrying you.

You'll reach an answerphone; leave your name and contact details and the Safeguarding Team or a Swimline volunteer will call you back, normally the next working day. If you need to speak to someone immediately, the message explains how to be transferred straight to the NSPCC. Calls are free and don't appear on an itemised bill unless made from a mobile.

## Your voice

Young swimmers can talk about anything that matters to them — the support they get from their coach, who they talk to when they're upset, who helps when swimming gets hard. Nothing is too small.

For anything involving the internet, the Child Exploitation and Online Protection Centre (CEOP) takes reports directly, and [thinkuknow.co.uk](https://www.thinkuknow.co.uk) has current advice on the sites, apps and phones young people use.`,
    section: "policies",
    sort_order: 2,
  },
];

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

console.log(`\nSeeding ${env.NEXT_PUBLIC_SUPABASE_URL}\n`);

// --- Venues (needed before sessions reference them by name) ---
console.log("Venues");
for (const v of [
  { slug: "salt-ayre", name: "Salt Ayre Leisure Centre", address: "Salt Ayre Lane, Lancaster", length_m: 25, lanes: 8, notes: "Our main pool and the home of our galas. Electronic timing installed.", sort_order: 1 },
  { slug: "salt-ayre-tank", name: "Salt Ayre Training Tank", address: "Salt Ayre Lane, Lancaster", length_m: 20, lanes: 4, notes: "The smaller teaching pool, used by Development, Cubs and Otters squads.", sort_order: 2 },
  { slug: "carnforth", name: "Carnforth Pool", address: "Carnforth High School, Carnforth", length_m: 20, lanes: 4, notes: "Friday evening sessions.", sort_order: 3 },
  { slug: "heysham", name: "Heysham Pool", address: "Heysham High School, Morecambe", length_m: 25, lanes: 6, notes: "Extra lane time for J-Squad and T-Squad.", sort_order: 4 },
]) {
  const { error } = await db.from("venues").upsert(v, { onConflict: "slug" });
  if (error) log(`✗ ${v.name} — ${error.message}`);
}
log(`4 venues`);

// --- Squads ---
console.log("Squads");
for (const s of SQUADS) {
  const { error } = await db.from("squads").upsert({ ...s, published: true }, { onConflict: "slug" });
  if (error) log(`✗ ${s.name} — ${error.message}`);
}
log(`${SQUADS.length} squads`);

// --- Training sessions: rebuilt wholesale, they're derived from the timetable ---
console.log("Training times");
const { data: squadRows } = await db.from("squads").select("id, slug");
const squadId = new Map((squadRows ?? []).map((s) => [s.slug, s.id]));
let sessionCount = 0;
for (const [slug, list] of Object.entries(SESSIONS)) {
  const id = squadId.get(slug);
  if (!id) { log(`✗ no squad "${slug}"`); continue; }
  await db.from("training_sessions").delete().eq("squad_id", id);
  const rows = list.map(([day, venue, starts, ends, note], i) => ({
    squad_id: id, day_of_week: day, venue, starts_at: starts, ends_at: ends,
    note: note ?? null, sort_order: i,
  }));
  const { error } = await db.from("training_sessions").insert(rows);
  if (error) log(`✗ ${slug} — ${error.message}`);
  else sessionCount += rows.length;
}
log(`${sessionCount} sessions across ${Object.keys(SESSIONS).length} squads`);

// --- People ---
console.log("Who's Who");
const { data: existingPeople } = await db.from("people").select("id, name");
const peopleByName = new Map((existingPeople ?? []).map((p) => [p.name.toLowerCase(), p.id]));
let added = 0, updated = 0;
for (const p of PEOPLE) {
  const row = {
    name: p.name,
    roles: p.roles,
    sections: p.sections,
    primary_section: p.primary,
    email: p.email ?? null,
    sort_order: p.order,
    published: true,
  };
  const id = peopleByName.get(p.name.toLowerCase());
  const { error } = id
    ? await db.from("people").update(row).eq("id", id)
    : await db.from("people").insert(row);
  if (error) log(`✗ ${p.name} — ${error.message}`);
  else if (id) updated += 1;
  else added += 1;
}
log(`${added} added, ${updated} updated (${PEOPLE.length} total)`);

// --- Documents ---
console.log("Policy documents");
const { data: existingDocs } = await db.from("documents").select("id, title");
const docByTitle = new Map((existingDocs ?? []).map((d) => [d.title.toLowerCase(), d.id]));
for (const d of DOCUMENTS) {
  const id = docByTitle.get(d.title.toLowerCase());
  const { error } = id
    ? await db.from("documents").update(d).eq("id", id)
    : await db.from("documents").insert(d);
  if (error) log(`✗ ${d.title} — ${error.message}`);
}
log(`${DOCUMENTS.length} documents (${DOCUMENTS.filter((d) => !d.published).length} awaiting their PDF)`);

// --- Supporters ---
console.log("Supporters & accreditations");
const { data: existingSponsors } = await db.from("sponsors").select("id, name");
const sponsorByName = new Map((existingSponsors ?? []).map((s) => [s.name.toLowerCase(), s.id]));
for (const s of SPONSORS) {
  const row = { ...s, published: true };
  const id = sponsorByName.get(s.name.toLowerCase());
  const { error } = id
    ? await db.from("sponsors").update(row).eq("id", id)
    : await db.from("sponsors").insert(row);
  if (error) log(`✗ ${s.name} — ${error.message}`);
}
log(`${SPONSORS.length} entries (${SPONSORS.filter((s) => s.tier === "accreditation").length} accreditations)`);

// --- Pages ---
console.log("Page copy");
for (const p of PAGES) {
  const { error } = await db.from("pages").upsert({ ...p, published: true }, { onConflict: "slug" });
  if (error) log(`✗ ${p.slug} — ${error.message}`);
}
log(`${PAGES.length} page(s)`);

console.log(`
Done.

  Check these before going live:
  • Coach qualification levels came from a two-column table on the old site and
    may have been split wrongly — confirm who is Level 1 and who is Level 2.
  • The old site spells the Welfare Officer "Calire Wilcox"; seeded as "Claire".
  • ${DOCUMENTS.filter((d) => !d.published).length} policy documents are listed but unpublished — upload each PDF in
    Admin → Club settings → Club documents, then tick Published.
`);
