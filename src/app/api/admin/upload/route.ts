import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbAdmin, STORAGE_BUCKET, storageUrl } from "@/lib/supabase";
import { slugify } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — comfortably above any results PDF.

/** Documents and images only. Never anything the browser would execute. */
const ALLOWED = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["text/csv", "csv"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const client = dbAdmin();
  if (!client) {
    return NextResponse.json(
      { error: "Storage isn't configured — SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const folder = String(form.get("folder") ?? "uploads");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.` },
      { status: 413 }
    );
  }

  const extension = ALLOWED.get(file.type);
  if (!extension) {
    return NextResponse.json(
      { error: `Files of type "${file.type || "unknown"}" aren't allowed. Use PDF, JPG, PNG, WEBP, CSV, DOCX or XLSX.` },
      { status: 415 }
    );
  }

  const baseName = slugify(file.name.replace(/\.[^.]+$/, "")) || "file";
  const safeFolder = slugify(folder) || "uploads";
  const path = `${safeFolder}/${Date.now()}-${baseName}.${extension}`;

  const { error } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
      cacheControl: "31536000",
    });

  if (error) {
    return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    path,
    url: storageUrl(path),
    size: file.size,
    name: file.name,
  });
}
