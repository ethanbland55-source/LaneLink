import { db } from "./supabase";
import type {
  ClubDocument, ClubSettings, Gala, GalaEvent, GalaFile, GalaResult,
  GalaSeries, GalaSession, NewsPost, Newsletter, Page, Person, Sponsor,
  Squad, TrainingSession, Venue,
} from "./types";

/**
 * Every query returns a sensible empty value when Supabase isn't wired up yet,
 * so the whole site still builds and renders (with empty states) on a fresh
 * clone. That keeps `next build` green on Vercel before the database exists.
 */

export const revalidate = 60;

const DEFAULT_CLUB: ClubSettings = {
  name: "Carnforth & District Otters ASC",
  shortName: "Carnforth Otters",
  tagline: "Lancaster's competitive swimming club",
  strapline: "SwimMark accredited. Volunteer run. Swimmers aged 4 to masters.",
  // Role addresses taken from the club's own contact page — not invented.
  email: "secretary@carnforthotters.co.uk",
  emailChair: "chair@carnforthotters.co.uk",
  emailSecretary: "secretary@carnforthotters.co.uk",
  emailMembership: "membership@carnforthotters.co.uk",
  emailCompetitions: "competitions@carnforthotters.co.uk",
  emailWelfare: "welfare@carnforthotters.co.uk",
  emailWebsite: "website@carnforthotters.co.uk",
  facebook: "https://www.facebook.com/CARNFORTHOTTERS/",
  youtube: "https://www.youtube.com/@carnforth_otters",
  swimManager: "https://carnforth.swimmanager.co.uk",
  primaryVenue: "Salt Ayre Leisure Centre, Lancaster",
};

export async function getClubSettings(): Promise<ClubSettings> {
  const client = db();
  if (!client) return DEFAULT_CLUB;
  const { data } = await client.from("site_settings").select("value").eq("key", "club").maybeSingle();
  return { ...DEFAULT_CLUB, ...((data?.value as Partial<ClubSettings>) ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* Galas & results                                                             */
/* -------------------------------------------------------------------------- */

export async function getSeries(): Promise<GalaSeries[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("gala_series")
    .select("*")
    .eq("published", true)
    .order("sort_order");
  return (data as GalaSeries[]) ?? [];
}

export async function getGalas(opts: { limit?: number; homeOnly?: boolean } = {}): Promise<Gala[]> {
  const client = db();
  if (!client) return [];
  let q = client
    .from("galas")
    .select("*, series:gala_series(*)")
    .eq("published", true)
    .order("start_date", { ascending: false, nullsFirst: false });
  if (opts.homeOnly) q = q.eq("is_home", true);
  if (opts.limit) q = q.limit(opts.limit);
  const { data } = await q;
  return (data as Gala[]) ?? [];
}

export async function getGalasBySeries(seriesSlug: string): Promise<{ series: GalaSeries | null; galas: Gala[] }> {
  const client = db();
  if (!client) return { series: null, galas: [] };
  const { data: series } = await client
    .from("gala_series")
    .select("*")
    .eq("slug", seriesSlug)
    .maybeSingle();
  if (!series) return { series: null, galas: [] };
  const { data } = await client
    .from("galas")
    .select("*, series:gala_series(*)")
    .eq("series_id", series.id)
    .eq("published", true)
    .order("start_date", { ascending: false, nullsFirst: false });
  return { series: series as GalaSeries, galas: (data as Gala[]) ?? [] };
}

export async function getGala(slug: string): Promise<Gala | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("galas")
    .select("*, series:gala_series(*)")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  return (data as Gala) ?? null;
}

export async function getGalaSessions(galaId: string): Promise<GalaSession[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("gala_sessions")
    .select("*")
    .eq("gala_id", galaId)
    .order("number");
  return (data as GalaSession[]) ?? [];
}

export async function getGalaEvents(galaId: string): Promise<GalaEvent[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("gala_events")
    .select("*")
    .eq("gala_id", galaId)
    .order("sort_order")
    .order("number");
  return (data as GalaEvent[]) ?? [];
}

export async function getGalaEvent(galaId: string, eventNumber: number): Promise<GalaEvent | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("gala_events")
    .select("*")
    .eq("gala_id", galaId)
    .eq("number", eventNumber)
    .maybeSingle();
  return (data as GalaEvent) ?? null;
}

export async function getEventResults(
  eventId: string,
  kind: "result" | "startlist" = "result"
): Promise<GalaResult[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("gala_results")
    .select("*")
    .eq("event_id", eventId)
    .eq("kind", kind)
    .order("sort_order");
  return (data as GalaResult[]) ?? [];
}

/** Every result for one gala — used by the swimmer search and medal table. */
export async function getGalaResults(galaId: string): Promise<GalaResult[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("gala_results")
    .select("*")
    .eq("gala_id", galaId)
    .eq("kind", "result")
    .order("sort_order")
    .limit(20000);
  return (data as GalaResult[]) ?? [];
}

export async function getGalaFiles(galaId: string): Promise<GalaFile[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("gala_files")
    .select("*")
    .eq("gala_id", galaId)
    .order("group_key")
    .order("sort_order");
  return (data as GalaFile[]) ?? [];
}

/** The gala currently being run, if any — drives the Live page and home banner. */
export async function getLiveGala(): Promise<Gala | null> {
  const client = db();
  if (!client) return null;
  const today = new Date().toISOString().slice(0, 10);

  const { data: flagged } = await client
    .from("galas")
    .select("*, series:gala_series(*)")
    .eq("published", true)
    .eq("is_live", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (flagged) return flagged as Gala;

  const { data } = await client
    .from("galas")
    .select("*, series:gala_series(*)")
    .eq("published", true)
    .eq("is_home", true)
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1)
    .maybeSingle();
  return (data as Gala) ?? null;
}

export async function getUpcomingGalas(limit = 4): Promise<Gala[]> {
  const client = db();
  if (!client) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await client
    .from("galas")
    .select("*, series:gala_series(*)")
    .eq("published", true)
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(limit);
  return (data as Gala[]) ?? [];
}

/* -------------------------------------------------------------------------- */
/* Site content                                                                */
/* -------------------------------------------------------------------------- */

export async function getPeople(): Promise<Person[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("people")
    .select("*")
    .eq("published", true)
    .order("sort_order")
    .order("name");
  return (data as Person[]) ?? [];
}

export async function getNewsletters(limit?: number): Promise<Newsletter[]> {
  const client = db();
  if (!client) return [];
  let q = client
    .from("newsletters")
    .select("*")
    .eq("published", true)
    .order("issue_date", { ascending: false });
  if (limit) q = q.limit(limit);
  const { data } = await q;
  return (data as Newsletter[]) ?? [];
}

export async function getNews(limit?: number): Promise<NewsPost[]> {
  const client = db();
  if (!client) return [];
  let q = client
    .from("news")
    .select("*")
    .eq("published", true)
    .order("published_at", { ascending: false });
  if (limit) q = q.limit(limit);
  const { data } = await q;
  return (data as NewsPost[]) ?? [];
}

export async function getNewsPost(slug: string): Promise<NewsPost | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("news")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  return (data as NewsPost) ?? null;
}

export async function getPage(slug: string): Promise<Page | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("pages")
    .select("*")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  return (data as Page) ?? null;
}

export async function getSquads(): Promise<Squad[]> {
  const client = db();
  if (!client) return [];
  const { data: squads } = await client
    .from("squads")
    .select("*")
    .eq("published", true)
    .order("sort_order");
  if (!squads?.length) return [];
  const { data: sessions } = await client
    .from("training_sessions")
    .select("*")
    .order("day_of_week")
    .order("sort_order");
  const byId = new Map<string, TrainingSession[]>();
  for (const s of (sessions as TrainingSession[]) ?? []) {
    const list = byId.get(s.squad_id);
    if (list) list.push(s);
    else byId.set(s.squad_id, [s]);
  }
  return (squads as Squad[]).map((s) => ({ ...s, sessions: byId.get(s.id) ?? [] }));
}

export async function getVenues(): Promise<Venue[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client.from("venues").select("*").order("sort_order");
  return (data as Venue[]) ?? [];
}

export async function getDocuments(category?: string): Promise<ClubDocument[]> {
  const client = db();
  if (!client) return [];
  let q = client.from("documents").select("*").eq("published", true).order("sort_order");
  if (category) q = q.eq("category", category);
  const { data } = await q;
  return (data as ClubDocument[]) ?? [];
}

export async function getSponsors(): Promise<Sponsor[]> {
  const client = db();
  if (!client) return [];
  const { data } = await client
    .from("sponsors")
    .select("*")
    .eq("published", true)
    .order("sort_order");
  return (data as Sponsor[]) ?? [];
}
