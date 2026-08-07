/**
 * Allowlist of tables and columns the admin API may write to.
 *
 * Nothing outside this map can be touched, even with a valid session — so a
 * mistyped fetch in the admin UI can't drop a column it wasn't meant to see,
 * and a future bug can't turn into arbitrary database access.
 */

export const WRITABLE: Record<string, readonly string[]> = {
  gala_series: ["slug", "name", "blurb", "accent", "sort_order", "published"],
  galas: [
    "series_id", "slug", "name", "edition_year", "start_date", "end_date", "venue",
    "course", "meet_type", "licence", "is_home", "entry_status", "entry_url",
    "stream_url", "promoter", "contact_email", "description", "results_note",
    "published", "is_live", "ingest_token",
  ],
  gala_sessions: [
    "gala_id", "number", "name", "session_date", "warmup_time", "start_time",
    "start_list_url", "results_url", "sort_order",
  ],
  gala_events: [
    "gala_id", "session_id", "number", "name", "distance", "stroke", "gender",
    "age_group", "round", "is_relay", "scheduled_at", "start_list_url",
    "results_url", "has_results", "has_start_list", "sort_order",
  ],
  gala_files: ["gala_id", "group_key", "label", "file_url", "file_size", "sort_order"],
  newsletters: [
    "title", "issue_date", "period_start", "period_end", "summary", "file_url",
    "file_size", "cover_url", "page_count", "published",
  ],
  people: [
    "name", "roles", "sections", "primary_section", "bio", "email", "phone",
    "photo_url", "sort_order", "published",
  ],
  news: ["slug", "title", "excerpt", "body", "image_url", "published_at", "published"],
  pages: ["slug", "title", "intro", "body", "section", "sort_order", "published"],
  squads: ["slug", "name", "tagline", "description", "hours_guide", "sort_order", "published"],
  training_sessions: [
    "squad_id", "day_of_week", "venue", "starts_at", "ends_at", "note", "sort_order",
  ],
  venues: ["slug", "name", "address", "postcode", "lanes", "length_m", "notes", "map_url", "sort_order"],
  sponsors: ["name", "url", "logo_url", "blurb", "tier", "sort_order", "published"],
  documents: ["title", "category", "file_url", "file_size", "updated_on", "sort_order", "published"],
  site_settings: ["key", "value"],
};

export type WritableTable = keyof typeof WRITABLE;

export function isWritable(table: string): table is WritableTable {
  return Object.hasOwn(WRITABLE, table);
}

/** Drop anything not on the allowlist, and normalise empty strings to null. */
export function sanitiseRecord(
  table: WritableTable,
  input: Record<string, unknown>
): Record<string, unknown> {
  const allowed = WRITABLE[table];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    out[key] = value === "" ? null : value;
  }
  return out;
}
