export type GalaSeries = {
  id: string;
  slug: string;
  name: string;
  blurb: string | null;
  accent: "purple" | "gold" | "teal" | string;
  sort_order: number;
  published: boolean;
};

export type Gala = {
  id: string;
  series_id: string | null;
  slug: string;
  name: string;
  edition_year: number | null;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  course: string | null;
  meet_type: string | null;
  licence: string | null;
  is_home: boolean;
  entry_status: string | null;
  entry_url: string | null;
  stream_url: string | null;
  promoter: string | null;
  contact_email: string | null;
  description: string | null;
  results_note: string | null;
  published: boolean;
  is_live: boolean;
  imported_at: string | null;
  created_at: string;
  series?: GalaSeries | null;
};

export type GalaSession = {
  id: string;
  gala_id: string;
  number: number;
  name: string | null;
  session_date: string | null;
  warmup_time: string | null;
  start_time: string | null;
  start_list_url: string | null;
  results_url: string | null;
  sort_order: number;
};

export type GalaEvent = {
  id: string;
  gala_id: string;
  session_id: string | null;
  number: number;
  name: string;
  distance: number | null;
  stroke: string | null;
  gender: string | null;
  age_group: string | null;
  round: string | null;
  is_relay: boolean;
  scheduled_at: string | null;
  start_list_url: string | null;
  results_url: string | null;
  has_results: boolean;
  sort_order: number;
};

export type Split = { distance: number; time: string };

export type GalaResult = {
  id: string;
  gala_id: string;
  event_id: string;
  heat_number: number | null;
  lane: number | null;
  place: number | null;
  swimmer_name: string;
  birth_year: number | null;
  age: number | null;
  club: string | null;
  club_code: string | null;
  swim_time: string | null;
  swim_time_cs: number | null;
  reaction_time: string | null;
  points: number | null;
  status: string | null;
  dq_code: string | null;
  splits: Split[];
  relay_members: { name: string; leg: number }[] | null;
  is_home_club: boolean;
  is_final: boolean;
  sort_order: number;
};

export type GalaFile = {
  id: string;
  gala_id: string;
  group_key: string;
  label: string;
  file_url: string;
  file_size: number | null;
  sort_order: number;
};

export type Person = {
  id: string;
  name: string;
  roles: string[];
  sections: string[];
  bio: string | null;
  email: string | null;
  photo_url: string | null;
  sort_order: number;
  published: boolean;
};

export type Newsletter = {
  id: string;
  title: string;
  issue_date: string;
  summary: string | null;
  file_url: string;
  file_size: number | null;
  cover_url: string | null;
  published: boolean;
};

export type NewsPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  image_url: string | null;
  published_at: string;
  published: boolean;
};

export type Page = {
  id: string;
  slug: string;
  title: string;
  intro: string | null;
  body: string | null;
  section: string | null;
  sort_order: number;
  published: boolean;
};

export type Squad = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  hours_guide: string | null;
  sort_order: number;
  published: boolean;
  sessions?: TrainingSession[];
};

export type TrainingSession = {
  id: string;
  squad_id: string;
  day_of_week: number;
  venue: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  sort_order: number;
};

export type Venue = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  postcode: string | null;
  lanes: number | null;
  length_m: number | null;
  notes: string | null;
  map_url: string | null;
  sort_order: number;
};

export type ClubDocument = {
  id: string;
  title: string;
  category: string;
  file_url: string;
  file_size: number | null;
  updated_on: string | null;
  sort_order: number;
  published: boolean;
};

export type Sponsor = {
  id: string;
  name: string;
  url: string | null;
  logo_url: string | null;
  blurb: string | null;
  tier: string;
  sort_order: number;
  published: boolean;
};

export type ClubSettings = {
  name: string;
  shortName: string;
  tagline: string;
  strapline: string;
  email: string;
  facebook?: string;
  youtube?: string;
  instagram?: string;
  swimManager?: string;
  primaryVenue?: string;
};

/** Lifecycle derived from dates — never set by hand. */
export type GalaStatus = "upcoming" | "live" | "recent" | "archived";

export const FILE_GROUPS: { key: string; label: string; note: string }[] = [
  { key: "conditions", label: "Meet conditions", note: "Timetable, age groups, qualifying and closing dates" },
  { key: "programme", label: "Programme of events", note: "Running order and session programme" },
  { key: "entry", label: "Entry files", note: "Entry packs and team manager files" },
  { key: "accepted", label: "Accepted entries", note: "Who is in, by event" },
  { key: "warmup", label: "Warm-up times", note: "Session warm-up and start times" },
  { key: "results", label: "Results & heats", note: "Heat sheets and results" },
  { key: "other", label: "Other documents", note: "Anything else for this gala" },
];

export const PERSON_SECTIONS: { key: string; label: string; eyebrow: string }[] = [
  { key: "committee", label: "Committee", eyebrow: "Elected each year at the AGM" },
  { key: "coaches", label: "Coaching Team", eyebrow: "Poolside, every session" },
  { key: "managers", label: "Team Managers", eyebrow: "Looking after swimmers at galas" },
  { key: "officials", label: "Officials", eyebrow: "Licensed judges on the gantry" },
];
