import type { Gala, GalaStatus } from "./types";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

const WEEKDAY_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? "" : LONG_DATE.format(d);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? "" : SHORT_DATE.format(d);
}

export function formatWeekday(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? "" : WEEKDAY_DATE.format(d).toUpperCase();
}

/** "17–18 January 2026" or "17 January 2026" when it's a single day. */
export function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start) return "";
  if (!end || end === start) return formatDate(start);
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return formatDate(start);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  if (sameMonth) return `${s.getUTCDate()}–${formatDate(end)}`;
  return `${formatShortDate(start)} – ${formatDate(end)}`;
}

/**
 * A gala's lifecycle, derived from its dates so nobody has to remember to
 * switch it over: upcoming → live (on the day) → recent → archived.
 */
export function galaStatus(gala: Pick<Gala, "start_date" | "end_date" | "is_live">): GalaStatus {
  if (gala.is_live) return "live";
  if (!gala.start_date) return "upcoming";
  const today = new Date();
  const todayISO = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const start = new Date(`${gala.start_date}T00:00:00Z`);
  const end = new Date(`${gala.end_date ?? gala.start_date}T00:00:00Z`);
  if (todayISO < start) return "upcoming";
  if (todayISO <= end) return "live";
  const recentUntil = new Date(end);
  recentUntil.setUTCDate(recentUntil.getUTCDate() + 21);
  return todayISO <= recentUntil ? "recent" : "archived";
}

export function courseLabel(course: string | null | undefined): string {
  if (!course) return "";
  const c = course.toUpperCase();
  if (c.startsWith("LC") || c === "LCM") return "Long course (50m)";
  if (c.startsWith("SC") || c === "SCM") return "Short course (25m)";
  return course;
}

export function meetTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "club-gala": return "Club gala";
    case "open-meet": return "Open meet";
    case "league": return "League fixture";
    default: return "Meet";
  }
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/* -------------------------------------------------------------------------- */
/* Minimal, safe Markdown                                                      */
/*                                                                             */
/* Page bodies are written by club volunteers, so we escape everything first    */
/* and then allow a deliberately small set of formatting. No raw HTML gets      */
/* through, which means no way to inject a script by pasting from Word.         */
/* -------------------------------------------------------------------------- */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
      '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Markdown → HTML string, for use with dangerouslySetInnerHTML. */
export function markdownToHtml(md: string | null | undefined): string {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length + 1, 5); // ## → h3, page owns h1/h2
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      closeParagraph();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      closeParagraph();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      closeParagraph();
      closeList();
      out.push("<hr />");
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  closeParagraph();
  closeList();
  return out.join("\n");
}
