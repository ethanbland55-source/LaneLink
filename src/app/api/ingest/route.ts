import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { dbAdmin, STORAGE_BUCKET, storageUrl } from "@/lib/supabase";
import {
  isLiveTickerFile, isShellFile, parseSportsysFilename, parseSportsysHtml,
} from "@/lib/sportsys";
import { timeToCentiseconds } from "@/lib/lenex";
import { slugify } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Gala-day ingest endpoint.
 *
 * This is the HTTPS replacement for ResPost's FTP upload. The poster script on
 * the meet laptop (scripts/otters-poster.mjs) watches Meet Organisation's
 * `webpages` and `LiveRes` folders and POSTs each file here as it changes —
 * which is how results appear on the site within seconds of a race, without
 * anyone touching the website during the gala.
 *
 * Auth is a per-gala token, so a leaked token can only ever write to the one
 * gala it belongs to.
 *
 *   POST /api/ingest
 *   Authorization: Bearer <gala ingest token>
 *   multipart/form-data: file=<the file>, filename=<original name>
 */

function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) { timingSafeEqual(bb, bb); return false; }
  return timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const client = dbAdmin();
  if (!client) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Missing upload token." }, { status: 401 });
  }

  const { data: gala } = await client
    .from("galas")
    .select("id, slug, name, ingest_token")
    .eq("ingest_token", token)
    .maybeSingle();

  if (!gala || !gala.ingest_token || !tokensMatch(token, gala.ingest_token)) {
    return NextResponse.json({ error: "Upload token not recognised." }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file sent." }, { status: 400 });
  }
  const filename = String(form.get("filename") ?? file.name ?? "");
  const lower = filename.toLowerCase();

  const touch = async (extra: Record<string, unknown> = {}) => {
    await client.from("galas")
      .update({ last_file_at: new Date().toISOString(), ...extra })
      .eq("id", gala.id);
  };

  // ---- Meet Organisation's own page furniture: ignore, we have our own -----
  if (isShellFile(filename)) {
    return NextResponse.json({ ok: true, action: "skipped", reason: "page furniture" });
  }

  // ---- The rolling "last race" panel ---------------------------------------
  if (isLiveTickerFile(filename)) {
    const html = await file.text();
    await touch({ live_html: extractBody(html), live_updated_at: new Date().toISOString() });
    revalidatePath("/live");
    revalidatePath(`/results/${gala.slug}`);
    return NextResponse.json({ ok: true, action: "live-panel" });
  }

  // ---- PDFs and other documents --------------------------------------------
  if (/\.(pdf|csv|xlsx?|docx?)$/i.test(lower)) {
    const bytes = await file.arrayBuffer();
    const path = `galas/${gala.slug}/${slugify(filename.replace(/\.[^.]+$/, ""))}${lower.slice(lower.lastIndexOf("."))}`;
    const { error } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: file.type || "application/pdf", upsert: true });
    if (error) {
      return NextResponse.json({ error: `Storage upload failed: ${error.message}` }, { status: 500 });
    }

    const url = storageUrl(path);
    const label = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    const group = /heat|start/i.test(label) ? "warmup"
      : /result/i.test(label) ? "results"
      : /condition|programme|program/i.test(label) ? "conditions"
      : "results";

    const { data: existing } = await client
      .from("gala_files").select("id").eq("gala_id", gala.id).eq("file_url", url).maybeSingle();
    if (existing) {
      await client.from("gala_files").update({ label, file_size: file.size }).eq("id", existing.id);
    } else {
      await client.from("gala_files")
        .insert({ gala_id: gala.id, group_key: group, label, file_url: url, file_size: file.size });
    }

    await touch();
    revalidatePath(`/results/${gala.slug}`);
    revalidatePath("/live");
    return NextResponse.json({ ok: true, action: "file", url });
  }

  // ---- Sportsystems result / start-list pages -------------------------------
  if (!/\.html?$/i.test(lower)) {
    return NextResponse.json({ ok: true, action: "skipped", reason: "unsupported type" });
  }

  const meta = parseSportsysFilename(filename);
  if (!meta.kind || meta.eventNumber === null) {
    return NextResponse.json({ ok: true, action: "skipped", reason: "unrecognised filename" });
  }

  const html = await file.text();
  const parsed = parseSportsysHtml(html, filename);
  if (!parsed.totalRows) {
    return NextResponse.json({ ok: true, action: "skipped", reason: "no rows in file" });
  }

  // Find or create the event. A gala's programme usually exists already (typed
  // in, or from a pre-meet Lenex), but a file for an unknown event still lands
  // rather than being thrown away.
  const { data: event } = await client
    .from("gala_events")
    .select("id, name, session_id, sort_order")
    .eq("gala_id", gala.id)
    .eq("number", meta.eventNumber)
    .maybeSingle();

  let eventId = event?.id ?? null;
  if (!eventId) {
    const { data: created, error } = await client
      .from("gala_events")
      .insert({
        gala_id: gala.id,
        number: meta.eventNumber,
        name: parsed.eventName ?? `Event ${meta.eventNumber}`,
        gender: meta.gender,
        round: parsed.round ?? meta.round,
        age_group: parsed.blocks.length === 1 ? parsed.blocks[0].ageGroup : null,
        sort_order: meta.eventNumber,
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json({ error: `Could not create event: ${error.message}` }, { status: 500 });
    }
    eventId = created.id;
  }

  const kind = meta.kind === "startlist" ? "startlist" : "result";

  // Replace this event's rows of this kind — re-sends are common and must be
  // idempotent, not additive.
  await client.from("gala_results").delete().eq("event_id", eventId).eq("kind", kind);

  const rows: Record<string, unknown>[] = [];
  let order = 0;
  for (const block of parsed.blocks) {
    for (const r of block.rows) {
      const club = (r.club ?? "").toLowerCase();
      rows.push({
        gala_id: gala.id,
        event_id: eventId,
        kind,
        heat_number: r.heatNumber,
        lane: r.lane,
        place: kind === "result" ? r.place : null,
        swimmer_name: r.swimmerName,
        age: r.age,
        club: r.club,
        swim_time: kind === "result" ? r.swimTime : null,
        swim_time_cs: kind === "result" ? timeToCentiseconds(r.swimTime) : null,
        seed_time: kind === "startlist" ? r.swimTime : null,
        points: r.points,
        status: r.status || null,
        splits: r.splits,
        is_home_club: club.includes("carnforth"),
        source: "sportsys",
        sort_order: order++,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from("gala_results").insert(rows.slice(i, i + 500));
    if (error) {
      return NextResponse.json({ error: `Saving rows failed: ${error.message}` }, { status: 500 });
    }
  }

  const eventPatch: Record<string, unknown> =
    kind === "result"
      ? { has_results: true, results_at: new Date().toISOString() }
      : { has_start_list: true };
  if (!event?.name && parsed.eventName) eventPatch.name = parsed.eventName;
  await client.from("gala_events").update(eventPatch).eq("id", eventId);

  // Mark the session as having released its start lists.
  if (kind === "startlist" && event?.session_id) {
    await client.from("gala_sessions")
      .update({ start_lists_at: new Date().toISOString() })
      .eq("id", event.session_id)
      .is("start_lists_at", null);
  }

  await touch();
  revalidatePath(`/results/${gala.slug}`);
  revalidatePath(`/results/${gala.slug}/events/${meta.eventNumber}`);
  revalidatePath("/live");

  return NextResponse.json({
    ok: true,
    action: kind,
    event: meta.eventNumber,
    eventName: parsed.eventName,
    rows: rows.length,
  });
}

/** Keep just the inner markup of a Sportsystems live panel. */
function extractBody(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const inner = body ? body[1] : html;
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .trim()
    .slice(0, 200_000);
}
