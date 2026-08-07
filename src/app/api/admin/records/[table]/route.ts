import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/auth";
import { dbAdmin } from "@/lib/supabase";
import { isWritable, sanitiseRecord } from "@/lib/admin-tables";

export const runtime = "nodejs";

/**
 * One generic CRUD endpoint for every admin-editable table, guarded by the
 * allowlist in admin-tables.ts. Keeps the admin UI simple and means new fields
 * only need adding in one place.
 */

async function guard(table: string) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!isWritable(table)) {
    return NextResponse.json({ error: `"${table}" isn't editable.` }, { status: 400 });
  }
  if (!dbAdmin()) {
    return NextResponse.json(
      { error: "Database isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 503 }
    );
  }
  return null;
}

/** Bust the cache broadly — the site is small and correctness beats cleverness. */
function refresh() {
  revalidatePath("/", "layout");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const blocked = await guard(table);
  if (blocked) return blocked;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const record = sanitiseRecord(table as never, body as Record<string, unknown>);
  const client = dbAdmin()!;

  // site_settings is a key/value store, so upsert rather than insert.
  const query =
    table === "site_settings"
      ? client.from(table).upsert(record, { onConflict: "key" }).select().single()
      : client.from(table).insert(record).select().single();

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  refresh();
  return NextResponse.json({ ok: true, record: data });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const blocked = await guard(table);
  if (blocked) return blocked;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const record = sanitiseRecord(table as never, body as Record<string, unknown>);
  const idColumn = table === "site_settings" ? "key" : "id";

  const { data, error } = await dbAdmin()!
    .from(table)
    .update(record)
    .eq(idColumn, id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  refresh();
  return NextResponse.json({ ok: true, record: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const blocked = await guard(table);
  if (blocked) return blocked;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const idColumn = table === "site_settings" ? "key" : "id";
  const { error } = await dbAdmin()!.from(table).delete().eq(idColumn, id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  refresh();
  return NextResponse.json({ ok: true });
}
