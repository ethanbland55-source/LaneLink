/**
 * Parser for SPORTSYSTEMS Meet Organisation web result files.
 *
 * These are the `R*.HTM` / `S*.HTM` files Meet Organisation writes into its
 * `webpages` folder as a meet runs — the same files that appear on
 * results.swimming.org. They are plain HTML tables with a fixed set of CSS
 * classes, so they can be read without a DOM library.
 *
 * Why this exists alongside the Lenex parser:
 *   Lenex is a manual "File → Export" at the end of a meet — perfect for the
 *   permanent archive, useless for live coverage. These files appear within
 *   seconds of each race being processed, so they are what drives the site
 *   during a gala. The Lenex import later replaces the lot with the
 *   authoritative version.
 *
 * File naming: <R|S><gender><strokecode><round><event number>.HTM
 *   RM6H101   result, men, heats, event 101
 *   SW3F251   start list, women, final, event 251
 * The event number is the trailing digits — that's what links a file to the
 * programme.
 */

export type SportsysRow = {
  place: number | null;
  heatNumber: number | null;
  lane: number | null;
  swimmerName: string;
  age: number | null;
  club: string | null;
  swimTime: string | null;
  points: number | null;
  status: string;
  splits: { distance: number; time: string }[];
  relayMembers: { name: string; leg: number }[] | null;
};

export type SportsysBlock = {
  ageGroup: string | null;
  rows: SportsysRow[];
};

export type SportsysFile = {
  kind: "result" | "startlist";
  eventNumber: number | null;
  gender: string | null;
  round: string | null;
  eventName: string | null;
  blocks: SportsysBlock[];
  totalRows: number;
};

/* -------------------------------------------------------------------------- */
/* Filename                                                                    */
/* -------------------------------------------------------------------------- */

const ROUND_CODES: Record<string, string> = {
  H: "HEATS",
  F: "FINAL",
  S: "SEMI",
  Q: "QUARTER",
  T: "TIMEDFINAL",
};

const GENDER_CODES: Record<string, string> = {
  M: "M", B: "M",          // Men / Boys
  W: "F", G: "F", L: "F",  // Women / Girls / Ladies
  X: "X", A: "X",          // Mixed / All
};

export function parseSportsysFilename(name: string): {
  kind: "result" | "startlist" | null;
  eventNumber: number | null;
  gender: string | null;
  round: string | null;
} {
  const base = name.split(/[\\/]/).pop() ?? name;
  const m = base.toUpperCase().match(/^([RS])([A-Z])(\d+)([HFSQT])(\d+)\.HTM?L?$/);
  if (!m) return { kind: null, eventNumber: null, gender: null, round: null };
  return {
    kind: m[1] === "R" ? "result" : "startlist",
    gender: GENDER_CODES[m[2]] ?? null,
    round: ROUND_CODES[m[4]] ?? null,
    eventNumber: Number(m[5]),
  };
}

/** Files that are Meet Organisation's own page furniture — we have our own. */
const SHELL_FILES = new Set([
  "index.htm", "index.html", "main.htm", "top.htm", "before.htm", "after.htm",
  "disqcode.htm", "style.css", "menu.htm", "live.htm", "index2.htm",
]);

export function isShellFile(name: string): boolean {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  return SHELL_FILES.has(base);
}

/** The rolling "last race" / "last event" files ResPost maintains. */
export function isLiveTickerFile(name: string): boolean {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  return ["lastresult.htm", "lastrace.htm", "lastevnt.htm", "data.htm"].includes(base);
}

/* -------------------------------------------------------------------------- */
/* HTML helpers                                                                */
/* -------------------------------------------------------------------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function num(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * A time if it looks like one ("29.84", "2:06.93", "16:44.04"), otherwise null.
 * Deliberately strict so status text like "DQ" doesn't end up in a time column.
 */
function asTime(s: string): string | null {
  const t = s.trim();
  return /^\d{1,2}:\d{2}:\d{2}\.\d{2}$|^\d{1,3}:\d{2}\.\d{2}$|^\d{1,3}\.\d{2}$/.test(t) ? t : null;
}

const STATUS_WORDS = /^(DQ|DSQ|DNC|DNF|DNS|NS|WDR|SCR|EXH|R\d*)$/i;

function asStatus(s: string): string | null {
  const t = s.trim().toUpperCase();
  if (!t) return null;
  if (STATUS_WORDS.test(t)) return t === "DSQ" ? "DQ" : t === "NS" ? "DNS" : t;
  // Sportsystems sometimes prints "DQ SL 1.4" — take the leading token.
  const lead = t.split(/\s+/)[0];
  return STATUS_WORDS.test(lead) ? (lead === "DSQ" ? "DQ" : lead) : null;
}

/* -------------------------------------------------------------------------- */
/* Main parse                                                                  */
/* -------------------------------------------------------------------------- */

export function parseSportsysHtml(html: string, filename = ""): SportsysFile {
  const meta = parseSportsysFilename(filename);

  // Walk headings and tables in document order so each table keeps the
  // headings that introduced it.
  const tokens: { type: "h" | "table"; text: string }[] = [];
  const tokenRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>|<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1] !== undefined) tokens.push({ type: "h", text: stripTags(m[1]) });
    else if (m[2] !== undefined) tokens.push({ type: "table", text: m[2] });
  }

  let eventName: string | null = null;
  let round: string | null = meta.round;
  let ageGroup: string | null = null;
  const blocks: SportsysBlock[] = [];

  for (const token of tokens) {
    if (token.type === "h") {
      const text = token.text;
      if (!text) continue;

      // "Women's 200m Freestyle - Heats" / "… - Final (Declared Winners)"
      const eventMatch = text.match(/^(.*?)\s+-\s+(.*)$/);
      if (eventMatch && /\d+m|relay|freestyle|back|breast|butterfly|medley|im\b/i.test(eventMatch[1])) {
        eventName = eventMatch[1].trim();
        const roundText = eventMatch[2].toLowerCase();
        if (roundText.includes("heat")) round = "HEATS";
        else if (roundText.includes("semi")) round = "SEMI";
        else if (roundText.includes("final")) round = "FINAL";
        else if (roundText.includes("start")) round = round ?? "HEATS";
        continue;
      }

      // "13/14 Yrs Age Group - Full Results" / "Open Age Group"
      if (/age\s*group|yrs|years|open\b/i.test(text)) {
        ageGroup = text
          .replace(/\s*-\s*(full results|results|start list|heat declared winners).*$/i, "")
          .replace(/\s*age\s*group\s*$/i, "")
          .trim() || null;
        continue;
      }

      // A bare event title with no round suffix.
      if (!eventName && /\d+m/i.test(text)) eventName = text;
      continue;
    }

    const rows = parseTable(token.text);
    if (rows.length) blocks.push({ ageGroup, rows });
  }

  return {
    kind: meta.kind ?? "result",
    eventNumber: meta.eventNumber,
    gender: meta.gender,
    round,
    eventName,
    blocks,
    totalRows: blocks.reduce((n, b) => n + b.rows.length, 0),
  };
}

/* -------------------------------------------------------------------------- */

function parseTable(tableHtml: string): SportsysRow[] {
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*class\s*=\s*["']?([^"'\s>]*)["']?[^>]*>([\s\S]*?)<\/t[dh]>|<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  type Cell = { cls: string; text: string };
  const rows: Cell[][] = [];
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(tableHtml)) !== null) {
    const cells: Cell[] = [];
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      cells.push({
        cls: (cm[1] ?? "").toLowerCase(),
        text: stripTags(cm[2] ?? cm[3] ?? ""),
      });
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return [];

  // Column positions, recomputed whenever a header row appears — start lists
  // repeat their header under each "Heat Number - n" marker.
  let iPlace = -1, iName = -1, iAge = -1, iClub = -1, iTime = -1, iPoints = -1, iLane = -1;
  let splitCols: { index: number; distance: number }[] = [];
  let haveHeader = false;
  let currentHeat: number | null = null;

  const readHeader = (cells: { cls: string; text: string }[]) => {
    const header = cells.map((c) => c.text.toLowerCase().trim());
    const col = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
    iPlace = col("place", "pos");
    iName = col("name", "swimmer");
    iAge = col("aad", "age");
    iClub = col("club", "team");
    iTime = col("time");
    iPoints = col("wa pts", "fina pts", "pts", "points");
    iLane = col("lane");
    // Any purely numeric header is a split distance column (50, 100, 150…).
    splitCols = [];
    header.forEach((h, i) => {
      if (/^\d+$/.test(h) && i > Math.max(iTime, iName)) {
        splitCols.push({ index: i, distance: Number(h) });
      }
    });
    haveHeader = iName >= 0;
  };

  const out: SportsysRow[] = [];

  // Distance events don't have enough columns for every split, so Sportsystems
  // prints them on continuation rows beneath the swimmer as "450m 4:57.99".
  const SPLIT_CELL = /^(\d+)\s*m\s+([\d:.]+|-)$/i;
  const HEAT_MARKER = /heat\s*(?:number)?\s*[-–]?\s*(\d+)/i;

  for (const cells of rows) {
    const isHeaderish = cells.some((c) => c.cls.startsWith("t2"));

    if (isHeaderish) {
      // A single wide cell is a heat divider, not a header.
      const joined = cells.map((c) => c.text).join(" ");
      const heat = joined.match(HEAT_MARKER);
      if (cells.length <= 2 && heat) {
        currentHeat = Number(heat[1]);
        continue;
      }
      if (cells.length >= 3) readHeader(cells);
      continue;
    }

    if (!haveHeader) continue;

    const at = (i: number) => (i >= 0 && i < cells.length ? cells[i].text : "");
    const name = at(iName);
    const placeText = at(iPlace);

    // Fold a continuation row into the swimmer above it rather than treating
    // it as another entrant.
    const continuation: { distance: number; time: string }[] = [];
    for (const cell of cells) {
      const sm = cell.text.match(SPLIT_CELL);
      if (!sm) continue;
      const time = asTime(sm[2]);
      if (time) continuation.push({ distance: Number(sm[1]), time });
    }
    if (continuation.length && !num(placeText) && out.length) {
      out[out.length - 1].splits.push(...continuation);
      continue;
    }

    // Finals sheets print per-length differentials on a bare row underneath.
    // Cumulative splits are already captured, so drop these.
    if (!num(placeText) && asTime(name)) continue;

    if (!name || name === "-" || SPLIT_CELL.test(name)) continue;

    const timeText = at(iTime);
    const status = asStatus(timeText) ?? "";
    const swimTime = asTime(timeText);

    const splits = splitCols
      .map((s) => ({ distance: s.distance, time: asTime(at(s.index)) ?? "" }))
      .filter((s) => s.time);

    out.push({
      place: num(placeText),
      heatNumber: currentHeat,
      lane: iLane >= 0 ? num(at(iLane)) : null,
      swimmerName: name,
      age: iAge >= 0 ? num(at(iAge)) : null,
      club: iClub >= 0 ? (at(iClub) || null) : null,
      swimTime,
      points: iPoints >= 0 ? num(at(iPoints)) : null,
      status,
      splits,
      relayMembers: null,
    });
  }

  // Splits can arrive from both the header columns and continuation rows, so
  // tidy up: one entry per distance, in order.
  for (const row of out) {
    const seen = new Map<number, string>();
    for (const s of row.splits) if (!seen.has(s.distance)) seen.set(s.distance, s.time);
    row.splits = [...seen.entries()]
      .map(([distance, time]) => ({ distance, time }))
      .sort((a, b) => a.distance - b.distance);
  }

  return out;
}
