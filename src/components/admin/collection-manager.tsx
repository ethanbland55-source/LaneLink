"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle, Check, LoaderCircle, Pencil, Plus, Trash2, Upload, X,
} from "lucide-react";
import { blankRecord, type Field, type Row } from "./fields";

type Props = {
  table: string;
  singular: string;
  fields: Field[];
  rows: Row[];
  /** Column used for the row title in the list. */
  titleField: string;
  /** Optional secondary line in the list. */
  subtitle?: (row: Row) => string;
  emptyMessage?: string;
  /** Columns always written on save — e.g. the gala a file belongs to. */
  fixed?: Record<string, unknown>;
};

export default function CollectionManager({
  table, singular, fields, rows, titleField, subtitle, emptyMessage, fixed,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const startNew = () => { setError(null); setEditing(blankRecord(fields)); };
  const startEdit = (row: Row) => { setError(null); setEditing({ ...row }); };

  const setValue = (name: string, value: unknown) =>
    setEditing((current) => (current ? { ...current, [name]: value } : current));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);

    const payload: Row = { ...fixed };
    for (const field of fields) payload[field.name] = editing[field.name] ?? null;

    const isNew = !editing.id;
    const url = isNew
      ? `/api/admin/records/${table}`
      : `/api/admin/records/${table}?id=${encodeURIComponent(String(editing.id))}`;

    try {
      const response = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? "Save failed."); setBusy(false); return; }
      setEditing(null);
      setFlash(isNew ? `${singular} added.` : `${singular} updated.`);
      setTimeout(() => setFlash(null), 3500);
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  };

  const remove = async (row: Row) => {
    const label = String(row[titleField] ?? singular);
    if (!confirm(`Delete "${label}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/records/${table}?id=${encodeURIComponent(String(row.id))}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error ?? "Delete failed.");
      else { setFlash(`${singular} deleted.`); setTimeout(() => setFlash(null), 3500); router.refresh(); }
    } catch {
      setError("Couldn't reach the server.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      {flash && (
        <p className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-800">
          <Check className="h-4 w-4" aria-hidden />
          {flash}
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {editing ? (
        <form onSubmit={save} className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg">{editing.id ? `Edit ${singular.toLowerCase()}` : `New ${singular.toLowerCase()}`}</h2>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={editing[field.name]}
                onChange={(v) => setValue(field.name, v)}
                onSize={(bytes) => field.sizeField && setValue(field.sizeField, bytes)}
              />
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-60">
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {editing.id ? "Save changes" : `Add ${singular.toLowerCase()}`}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={startNew} className="btn btn-primary">
          <Plus className="h-4 w-4" aria-hidden />
          Add {singular.toLowerCase()}
        </button>
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-ink-500">
          {emptyMessage ?? `No ${singular.toLowerCase()} entries yet.`}
        </div>
      ) : (
        <ul className="card divide-y divide-ink-100">
          {rows.map((row) => (
            <li key={String(row.id)} className="flex items-center gap-4 px-5 py-3.5">
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-brand-900 truncate">
                  {String(row[titleField] ?? "Untitled")}
                  {row.published === false && (
                    <span className="ml-2 badge badge-muted">Draft</span>
                  )}
                </span>
                {subtitle && (
                  <span className="block text-[0.82rem] text-ink-500 truncate">{subtitle(row)}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => startEdit(row)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-brand-50 hover:text-brand-700"
                aria-label={`Edit ${String(row[titleField] ?? "")}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(row)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-700"
                aria-label={`Delete ${String(row[titleField] ?? "")}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const inputClass =
  "w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-[0.94rem] focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-brand-100";

export function FieldInput({
  field, value, onChange, onSize,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  onSize?: (bytes: number) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const id = `field-${field.name}`;
  const wide = !field.half && (field.type === "textarea" || field.type === "markdown" || field.type === "tags");

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("folder", field.folder ?? "uploads");
    try {
      const response = await fetch("/api/admin/upload", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setUploadError(data.error ?? "Upload failed.");
      else { onChange(data.url); onSize?.(data.size); }
    } catch {
      setUploadError("Upload failed — check your connection.");
    }
    setUploading(false);
  };

  return (
    <div className={wide ? "md:col-span-2" : field.half ? "" : "md:col-span-2"}>
      {field.type !== "boolean" && (
        <label htmlFor={id} className="block text-sm font-semibold text-brand-900 mb-1.5">
          {field.label}
          {field.required && <span className="text-red-600 ml-1">*</span>}
        </label>
      )}

      {field.type === "textarea" || field.type === "markdown" ? (
        <textarea
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={field.type === "markdown" ? 12 : 3}
          required={field.required}
          placeholder={field.placeholder}
          className={`${inputClass} font-mono text-[0.88rem] leading-relaxed`}
        />
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-3 cursor-pointer py-2">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4.5 w-4.5 rounded border-ink-300 text-brand-700 focus:ring-brand-300"
          />
          <span className="text-sm font-semibold text-brand-900">{field.label}</span>
        </label>
      ) : field.type === "select" ? (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className={inputClass}
        >
          <option value="">—</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === "tags" ? (
        <textarea
          id={id}
          value={Array.isArray(value) ? (value as string[]).join("\n") : ""}
          onChange={(e) =>
            onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
          }
          rows={4}
          placeholder={field.placeholder ?? "One per line"}
          className={inputClass}
        />
      ) : field.type === "file" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn btn-ghost btn-sm cursor-pointer">
              {uploading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Choose file"}
              <input
                type="file"
                accept={field.accept}
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
              />
            </label>
            {typeof value === "string" && value && (
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[0.85rem] text-brand-600 underline underline-offset-2 truncate max-w-xs"
              >
                View uploaded file
              </a>
            )}
          </div>
          <input
            id={id}
            type="url"
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste a link"
            className={inputClass}
          />
          {uploadError && <p className="text-sm text-red-700">{uploadError}</p>}
        </div>
      ) : (
        <input
          id={id}
          type={
            field.type === "number" ? "number"
            : field.type === "date" ? "date"
            : field.type === "time" ? "time"
            : field.type === "url" ? "url"
            : field.type === "email" ? "email"
            : "text"
          }
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(
              field.type === "number"
                ? (e.target.value === "" ? null : Number(e.target.value))
                : e.target.value
            )
          }
          required={field.required}
          placeholder={field.placeholder}
          className={inputClass}
        />
      )}

      {field.help && <p className="mt-1.5 text-[0.8rem] text-ink-500">{field.help}</p>}
    </div>
  );
}
