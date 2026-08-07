export type FieldType =
  | "text" | "textarea" | "markdown" | "number" | "date" | "boolean"
  | "select" | "tags" | "file" | "url" | "email" | "time";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Storage folder for `file` fields. */
  folder?: string;
  accept?: string;
  /** Show at half width on wide screens. */
  half?: boolean;
  defaultValue?: unknown;
  /** Also write the uploaded file's size into this column. */
  sizeField?: string;
};

export type Row = Record<string, unknown> & {
  id?: string;
  /**
   * Secondary line shown under the title in a list. Computed on the server by
   * `withSubtitle` — functions can't cross the server/client boundary, so the
   * string has to be worked out before the data is handed over.
   */
  _subtitle?: string;
};

/** Attach a display subtitle to each row before passing it to the client. */
export function withSubtitle<T extends Record<string, unknown>>(
  rows: T[],
  build: (row: T) => string
): Row[] {
  return rows.map((row) => ({ ...row, _subtitle: build(row) }));
}

export function blankRecord(fields: Field[]): Row {
  const out: Row = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) out[field.name] = field.defaultValue;
    else if (field.type === "boolean") out[field.name] = false;
    else if (field.type === "tags") out[field.name] = [];
    else if (field.type === "number") out[field.name] = null;
    else out[field.name] = "";
  }
  return out;
}
