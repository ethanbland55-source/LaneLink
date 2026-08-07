import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { dbAdmin } from "@/lib/supabase";
import { parseLenex } from "@/lib/lenex";

export const runtime = "nodejs";
export const maxDuration = 300;

const CHUNK = 500;

/**
 * Import a whole gala from a Sportsystems Meet Organisation Lenex export.
 *
 * The import is destructive *for that gala only*: sessions, events and results
 * are cleared and rebuilt, so re-uploading a corrected file after the meet
 * simply replaces the wrong data. Every other gala is untouched, which is what
 * keeps the Winter Gala archive intact while the Summer Gala is being loaded.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const client = dbAdmin();
  if (!client) {
    return NextResponse.json(
      { error: "Database isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const galaId = String(form.get("galaId") ?? "");
  const homeClubMatch = String(form.get("homeClub") ?? "carnforth").toLowerCase();
  const syncDetails = form.get("syncDetails") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  }
  if (!galaId) {
    return NextResponse.json({ error: "Pick which gala this file belongs to." }, { status: 400 });
  }

  const { data: gala, error: galaError } = await client
    .from("galas")
    .select("id, slug, name")
    .eq("id", galaId)
    .maybeSingle();
  if (galaError || !gala) {
    return NextResponse.json({ error: "That gala no longer exists." }, { status: 404 });
  }

  /* ---- Parse -------------------------------------------------------------- */

  let meet;
  try {
    meet = await parseLenex(await file.arrayBuffer(), file.name);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read that Lenex file." },
      { status: 422 }
    );
  }

  if (meet.events.length === 0) {
    return NextResponse.json(
      { error: "No events were found in that file — is it definitely a Meet Organisation export?" },
      { status: 422 }
    );
  }

  /* ---- Clear this gala's existing results --------------------------------- */
  // gala_sessions cascades to events, which cascades to results.
  await client.from("gala_results").delete().eq("gala_id", galaId);
  await client.from("gala_events").delete().eq("gala_id", galaId);
  await client.from("gala_sessions").delete().eq("gala_id", galaId);

  /* ---- Sessions ------------------------------------------------------------ */

  const sessionRows = meet.sessions.map((s, i) => ({
    gala_id: galaId,
    number: s.number,
    name: s.name,
    session_date: s.date,
    warmup_time: s.warmupTime,
    start_time: s.startTime,
    sort_order: i,
  }));

  const sessionIdByNumber = new Map<number, string>();
  if (sessionRows.length) {
    const { data, error } = await client.from("gala_sessions").insert(sessionRows).select("id, number");
    if (error) {
      return NextResponse.json({ error: `Saving sessions failed: ${error.message}` }, { status: 500 });
    }
    for (const row of data ?? []) sessionIdByNumber.set(row.number, row.id);
  }

  /* ---- Events -------------------------------------------------------------- */

  // Which Lenex events actually have results attached?
  const resultCountByEvent = new Map<string, number>();
  for (const r of meet.results) {
    resultCountByEvent.set(r.lenexEventId, (resultCountByEvent.get(r.lenexEventId) ?? 0) + 1);
  }

  const eventRows = meet.events.map((e, i) => ({
    gala_id: galaId,
    session_id: sessionIdByNumber.get(e.sessionNumber) ?? null,
    number: e.number,
    name: e.name,
    distance: e.distance,
    stroke: e.stroke,
    gender: e.gender,
    age_group: e.ageGroup,
    round: e.round,
    is_relay: e.isRelay,
    has_results: (resultCountByEvent.get(e.lenexId) ?? 0) > 0,
    sort_order: i,
  }));

  const eventIdByLenexId = new Map<string, string>();
  const { data: insertedEvents, error: eventError } = await client
    .from("gala_events")
    .insert(eventRows)
    .select("id, number, sort_order");
  if (eventError) {
    return NextResponse.json({ error: `Saving events failed: ${eventError.message}` }, { status: 500 });
  }
  // Match back by sort_order, which we controlled above.
  const bySortOrder = new Map((insertedEvents ?? []).map((row) => [row.sort_order, row.id]));
  meet.events.forEach((e, i) => {
    const id = bySortOrder.get(i);
    if (id) eventIdByLenexId.set(e.lenexId, id);
  });

  /* ---- Results ------------------------------------------------------------- */

  // Order within each event: finishers by place, then DQ/DNS at the bottom.
  const grouped = new Map<string, typeof meet.results>();
  for (const r of meet.results) {
    const list = grouped.get(r.lenexEventId);
    if (list) list.push(r);
    else grouped.set(r.lenexEventId, [r]);
  }

  const resultRows: Record<string, unknown>[] = [];
  for (const [lenexEventId, list] of grouped) {
    const eventId = eventIdByLenexId.get(lenexEventId);
    if (!eventId) continue;

    list.sort((a, b) => {
      if (a.status && !b.status) return 1;
      if (!a.status && b.status) return -1;
      if (a.place !== null && b.place !== null) return a.place - b.place;
      if (a.place !== null) return -1;
      if (b.place !== null) return 1;
      return (a.swimTimeCs ?? Infinity) - (b.swimTimeCs ?? Infinity);
    });

    list.forEach((r, i) => {
      const club = (r.club ?? "").toLowerCase();
      resultRows.push({
        gala_id: galaId,
        event_id: eventId,
        heat_number: r.heatNumber,
        lane: r.lane,
        place: r.place,
        swimmer_name: r.swimmerName,
        birth_year: r.birthYear,
        age: r.age,
        club: r.club,
        club_code: r.clubCode,
        swim_time: r.swimTime,
        swim_time_cs: r.swimTimeCs,
        reaction_time: r.reactionTime,
        points: r.points,
        status: r.status || null,
        splits: r.splits,
        relay_members: r.relayMembers,
        is_home_club: homeClubMatch !== "" && club.includes(homeClubMatch),
        is_final: false,
        sort_order: i,
      });
    });
  }

  for (let i = 0; i < resultRows.length; i += CHUNK) {
    const { error } = await client.from("gala_results").insert(resultRows.slice(i, i + CHUNK));
    if (error) {
      return NextResponse.json(
        { error: `Saving results failed at row ${i}: ${error.message}` },
        { status: 500 }
      );
    }
  }

  /* ---- Sync the gala header from the file, if asked ------------------------ */

  const galaPatch: Record<string, unknown> = { imported_at: new Date().toISOString() };
  if (syncDetails) {
    if (meet.startDate) galaPatch.start_date = meet.startDate;
    if (meet.endDate) galaPatch.end_date = meet.endDate;
    if (meet.venue) galaPatch.venue = meet.venue;
    if (meet.course) galaPatch.course = meet.course.startsWith("LC") ? "LC" : "SC";
  }
  await client.from("galas").update(galaPatch).eq("id", galaId);

  revalidatePath("/", "layout");

  const homeSwims = resultRows.filter((r) => r.is_home_club).length;

  return NextResponse.json({
    ok: true,
    summary: {
      meetName: meet.name,
      sessions: sessionRows.length,
      events: eventRows.length,
      eventsWithResults: eventRows.filter((e) => e.has_results).length,
      results: resultRows.length,
      homeSwims,
      clubs: meet.clubs.length,
      dates: [meet.startDate, meet.endDate].filter(Boolean).join(" → "),
      warnings: meet.warnings,
    },
  });
}
