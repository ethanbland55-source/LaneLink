/**
 * Lenex 3.0 parser.
 *
 * Lenex is the international interchange format for swimming meets. Sportsystems
 * Meet Organisation (which the club runs) exports it from File → Export, and it
 * carries the *entire* meet in one file: sessions, events, heats, clubs,
 * athletes, results, splits and rankings.
 *
 * Two file flavours exist and both are handled here:
 *   .lef  — plain XML
 *   .lxf  — a ZIP archive containing one .lef
 *
 * Deliberately forgiving: exports vary between vendors and versions, so every
 * lookup is defensive and anything missing simply comes back null rather than
 * throwing away the whole import.
 */

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type ParsedSession = {
  number: number;
  name: string | null;
  date: string | null;
  warmupTime: string | null;
  startTime: string | null;
};

export type ParsedEvent = {
  lenexId: string;
  number: number;
  order: number;
  sessionNumber: number;
  name: string;
  distance: number | null;
  stroke: string | null;
  gender: string;
  round: string;
  isRelay: boolean;
  ageGroup: string | null;
};

export type ParsedSplit = { distance: number; time: string };

export type ParsedResult = {
  lenexEventId: string;
  lenexResultId: string;
  heatNumber: number | null;
  lane: number | null;
  place: number | null;
  swimmerName: string;
  birthYear: number | null;
  age: number | null;
  club: string | null;
  clubCode: string | null;
  swimTime: string | null;
  swimTimeCs: number | null;
  reactionTime: string | null;
  points: number | null;
  status: string;
  splits: ParsedSplit[];
  relayMembers: { name: string; leg: number }[] | null;
  ageGroup: string | null;
};

export type ParsedMeet = {
  name: string;
  city: string | null;
  course: string | null;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  pointTable: string | null;
  sessions: ParsedSession[];
  events: ParsedEvent[];
  results: ParsedResult[];
  clubs: string[];
  warnings: string[];
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A parsed XML element. fast-xml-parser hands back plain objects whose keys are
 * child element names and `@`-prefixed attributes, so this is as specific as it
 * usefully gets.
 */
type Node = Record<string, unknown>;

/**
 * Always get an array of nodes back, whether the parser gave us one element,
 * none, or many — XML has no way to distinguish "one child" from "a list of
 * one", so every collection has to be normalised.
 */
function arr(v: unknown): Node[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as Node[];
}

/**
 * Read a child element off a node, always as a node. Missing children come back
 * as `{}` rather than undefined so attribute lookups can be chained safely.
 */
function child(node: Node | undefined, key: string): Node {
  const value = node?.[key];
  return (value && typeof value === "object" ? value : {}) as Node;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** "00:02:15.43" → 13543 centiseconds. Also copes with "2:15.43" and "15.43". */
export function timeToCentiseconds(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t || t === "NT" || t === "0" || /^0?0:00:00\.00$/.test(t)) return null;
  const m = t.match(/^(?:(\d+):)?(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, a, b, secs, frac] = m;
  let hours = 0;
  let minutes = 0;
  if (a !== undefined && b !== undefined) {
    hours = Number(a);
    minutes = Number(b);
  } else if (a !== undefined) {
    minutes = Number(a);
  }
  const seconds = Number(secs);
  const hundredths = frac ? Number(frac.padEnd(2, "0").slice(0, 2)) : 0;
  return ((hours * 3600 + minutes * 60 + seconds) * 100) + hundredths;
}

/** 13543 → "2:15.43". Drops leading zero units the way results sheets do. */
export function centisecondsToTime(cs: number | null | undefined): string | null {
  if (cs === null || cs === undefined || cs <= 0) return null;
  const hundredths = cs % 100;
  const totalSeconds = Math.floor(cs / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const hh = String(hundredths).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${hh}`;
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, "0")}.${hh}`;
  return `${seconds}.${hh}`;
}

const STROKE_NAMES: Record<string, string> = {
  FREE: "Freestyle",
  BACK: "Backstroke",
  BREAST: "Breaststroke",
  FLY: "Butterfly",
  MEDLEY: "IM",
  IM: "IM",
  UNKNOWN: "",
};

const ROUND_NAMES: Record<string, string> = {
  TIM: "TIMEDFINAL",
  FHT: "HEATS",
  PRE: "HEATS",
  FIN: "FINAL",
  SEM: "SEMI",
  QUA: "QUARTER",
  SOP: "SWIMOFF",
  SOS: "SWIMOFF",
  SOQ: "SWIMOFF",
};

const STATUS_NAMES: Record<string, string> = {
  DSQ: "DQ",
  DNS: "DNS",
  DNF: "DNF",
  SICK: "DNS",
  WDR: "WDR",
  EXH: "EXH",
};

export function genderLabel(g: string): string {
  switch (g) {
    case "M": return "Men's";
    case "F": return "Women's";
    case "X": return "Mixed";
    default: return "Open";
  }
}

/** "Women's 200m Freestyle" / "Men's 4x50m Freestyle Relay" */
export function buildEventName(opts: {
  gender: string;
  distance: number | null;
  stroke: string | null;
  relayCount: number;
}): string {
  const parts: string[] = [genderLabel(opts.gender)];
  const strokeName = opts.stroke ? (STROKE_NAMES[opts.stroke] ?? opts.stroke) : "";
  if (opts.relayCount > 1) {
    parts.push(`${opts.relayCount}x${opts.distance ?? ""}m`);
    parts.push(strokeName === "IM" ? "Medley" : strokeName);
    parts.push("Relay");
  } else {
    if (opts.distance) parts.push(`${opts.distance}m`);
    if (strokeName) parts.push(strokeName === "IM" ? "IM" : strokeName);
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/** Unwrap a .lxf ZIP, or pass plain .lef XML straight through. */
export async function extractLenexXml(file: ArrayBuffer, filename: string): Promise<string> {
  const looksZipped =
    filename.toLowerCase().endsWith(".lxf") ||
    filename.toLowerCase().endsWith(".zip") ||
    new Uint8Array(file.slice(0, 2)).every((b, i) => b === [0x50, 0x4b][i]);

  if (!looksZipped) return new TextDecoder("utf-8").decode(file);

  const zip = await JSZip.loadAsync(file);
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && /\.(lef|xml)$/i.test(f.name)
  );
  if (!entry) throw new Error("That .lxf archive doesn't contain a .lef file inside it.");
  return entry.async("string");
}

export async function parseLenex(file: ArrayBuffer, filename: string): Promise<ParsedMeet> {
  const xml = await extractLenexXml(file, filename);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseAttributeValue: false,
    trimValues: true,
    isArray: () => false,
  });

  const doc = parser.parse(xml) as Node;
  const root = (doc?.LENEX ?? doc?.lenex) as Node | undefined;
  if (!root) throw new Error("This doesn't look like a Lenex file — no <LENEX> element found.");

  const meet = arr(child(root, "MEETS").MEET)[0];
  if (!meet) throw new Error("No <MEET> found in the Lenex file.");

  const warnings: string[] = [];

  /* ---- Meet header ------------------------------------------------------- */

  const facility = child(meet, "FACILITY");
  const parsed: ParsedMeet = {
    name: str(meet["@name"]) ?? "Untitled meet",
    city: str(meet["@city"]) ?? str(facility["@city"]),
    course: str(meet["@course"]),
    startDate: null,
    endDate: null,
    venue: str(facility["@name"]) ?? str(meet["@city"]),
    pointTable: str(child(meet, "POINTTABLE")["@name"]),
    sessions: [],
    events: [],
    results: [],
    clubs: [],
    warnings,
  };

  /* ---- Sessions and events ----------------------------------------------- */

  // agegroupid → display name, for splitting results into age bands.
  const ageGroupById = new Map<string, string>();
  // resultid → place, taken from <RANKINGS> where the export provides them.
  const placeByResultId = new Map<string, number>();
  // resultid → agegroupid, likewise.
  const ageGroupByResultId = new Map<string, string>();

  const sessions = arr(child(meet, "SESSIONS").SESSION);
  const dates: string[] = [];

  sessions.forEach((session: Node, sIdx: number) => {
    const sessionNumber = num(session["@number"]) ?? sIdx + 1;
    const date = str(session["@date"]);
    if (date) dates.push(date);

    parsed.sessions.push({
      number: sessionNumber,
      name: str(session["@name"]),
      date,
      warmupTime: str(session["@warmupfrom"]),
      startTime: str(session["@daytime"]),
    });

    arr(child(session, "EVENTS").EVENT).forEach(
      (event: Node, eIdx: number) => {
        const style = child(event, "SWIMSTYLE");
        const relayCount = num(style["@relaycount"]) ?? 1;
        const distance = num(style["@distance"]);
        const stroke = str(style["@stroke"]);
        const gender = str(event["@gender"]) ?? "X";
        const rawRound = str(event["@round"]) ?? "TIM";

        // Age groups: one event can be split into several bands.
        const groups = arr(child(event, "AGEGROUPS").AGEGROUP);
        const groupNames: string[] = [];
        groups.forEach((g: Node) => {
          const id = str(g["@agegroupid"]);
          const min = num(g["@agemin"]);
          const max = num(g["@agemax"]);
          const name =
            str(g["@name"]) ??
            (min !== null && max !== null && min > 0 && max > 0
              ? `${min}/${max} Yrs`
              : min !== null && min > 0
                ? `${min} Yrs & Over`
                : "Open");
          if (id) ageGroupById.set(id, name);
          groupNames.push(name);

          arr(child(g, "RANKINGS").RANKING).forEach((r: Node) => {
            const rid = str(r["@resultid"]);
            const place = num(r["@place"]);
            if (rid && place !== null) placeByResultId.set(rid, place);
            if (rid && id) ageGroupByResultId.set(rid, id);
          });
        });

        const lenexId = str(event["@eventid"]) ?? `e${sessionNumber}-${eIdx}`;
        const parsedEvent: ParsedEvent = {
          lenexId,
          number: num(event["@number"]) ?? eIdx + 1,
          order: num(event["@order"]) ?? eIdx + 1,
          sessionNumber,
          name:
            str(style["@name"]) ??
            buildEventName({ gender, distance, stroke, relayCount }),
          distance,
          stroke: stroke === "MEDLEY" ? "IM" : stroke,
          gender,
          round: ROUND_NAMES[rawRound] ?? rawRound,
          isRelay: relayCount > 1,
          ageGroup: groupNames.length === 1 ? groupNames[0] : null,
        };
        parsed.events.push(parsedEvent);
      }
    );
  });

  dates.sort();
  parsed.startDate = dates[0] ?? null;
  parsed.endDate = dates[dates.length - 1] ?? null;

  /* ---- Heats: heatid → heat number --------------------------------------- */

  const heatNumberById = new Map<string, number>();
  sessions.forEach((session: Node) => {
    arr(child(session, "EVENTS").EVENT).forEach((event: Node) => {
      arr(child(event, "HEATS").HEAT).forEach((h: Node) => {
        const id = str(h["@heatid"]);
        const n = num(h["@number"]);
        if (id && n !== null) heatNumberById.set(id, n);
      });
    });
  });

  /* ---- Clubs, athletes, results ------------------------------------------ */

  const athleteNameById = new Map<string, string>();
  const clubs = arr(child(meet, "CLUBS").CLUB);

  // First pass: build the athlete lookup so relay legs can be named.
  clubs.forEach((club: Node) => {
    arr(child(club, "ATHLETES").ATHLETE).forEach((a: Node) => {
      const id = str(a["@athleteid"]);
      if (id) athleteNameById.set(id, formatName(a));
    });
  });

  const pushResult = (
    result: Node,
    who: {
      name: string;
      birthYear: number | null;
      club: string | null;
      clubCode: string | null;
    },
    relayMembers: { name: string; leg: number }[] | null
  ) => {
    const eventId = str(result["@eventid"]);
    if (!eventId) return;
    const resultId = str(result["@resultid"]) ?? `${eventId}-${who.name}`;
    const rawStatus = (str(result["@status"]) ?? "").toUpperCase();
    const status = STATUS_NAMES[rawStatus] ?? (rawStatus === "OK" ? "" : rawStatus);
    const swimTimeRaw = str(result["@swimtime"]);
    const cs = timeToCentiseconds(swimTimeRaw);

    const splits: ParsedSplit[] = arr(child(result, "SPLITS").SPLIT)
      .map((s: Node) => ({
        distance: num(s["@distance"]) ?? 0,
        time: centisecondsToTime(timeToCentiseconds(str(s["@swimtime"]))) ?? "-",
      }))
      .filter((s) => s.distance > 0)
      .sort((a, b) => a.distance - b.distance);

    const heatId = str(result["@heatid"]);
    const ageGroupId = ageGroupByResultId.get(resultId);

    parsed.results.push({
      lenexEventId: eventId,
      lenexResultId: resultId,
      heatNumber: heatId ? (heatNumberById.get(heatId) ?? null) : null,
      lane: num(result["@lane"]),
      place: placeByResultId.get(resultId) ?? null,
      swimmerName: who.name,
      birthYear: who.birthYear,
      age: null,
      club: who.club,
      clubCode: who.clubCode,
      swimTime: centisecondsToTime(cs),
      swimTimeCs: cs,
      reactionTime: str(result["@reactiontime"]),
      points: num(result["@points"]),
      status,
      splits,
      relayMembers,
      ageGroup: ageGroupId ? (ageGroupById.get(ageGroupId) ?? null) : null,
    });
  };

  clubs.forEach((club: Node) => {
    const clubName = str(club["@name"]) ?? str(club["@shortname"]);
    const clubCode = str(club["@code"]);
    if (clubName && !parsed.clubs.includes(clubName)) parsed.clubs.push(clubName);

    arr(child(club, "ATHLETES").ATHLETE).forEach((a: Node) => {
      const birth = str(a["@birthdate"]);
      const who = {
        name: formatName(a),
        birthYear: birth ? num(birth.slice(0, 4)) : null,
        club: clubName,
        clubCode,
      };
      arr(child(a, "RESULTS").RESULT).forEach((r: Node) => pushResult(r, who, null));
    });

    arr(child(club, "RELAYS").RELAY).forEach((relay: Node) => {
      const relayName = str(relay["@name"]) ?? clubName ?? "Relay";
      arr(child(relay, "RESULTS").RESULT).forEach((r: Node) => {
        const members = arr(child(r, "RELAYPOSITIONS").RELAYPOSITION)
          .map((p: Node) => {
            const athleteId = str(p["@athleteid"]);
            const inline = formatName(p);
            return {
              leg: num(p["@number"]) ?? 0,
              name:
                (athleteId ? athleteNameById.get(athleteId) : null) ??
                (inline !== "Unknown" ? inline : "—"),
            };
          })
          .sort((x, y) => x.leg - y.leg);

        pushResult(
          r,
          { name: relayName, birthYear: null, club: clubName, clubCode },
          members.length ? members : null
        );
      });
    });
  });

  /* ---- Fill in any missing places ---------------------------------------- */

  if (parsed.results.length && placeByResultId.size === 0) {
    warnings.push(
      "The export had no ranking data, so places were calculated from the times."
    );
  }
  computeMissingPlaces(parsed);

  if (!parsed.events.length) warnings.push("No events were found in this file.");
  if (!parsed.results.length) {
    warnings.push(
      "No results were found — this looks like an entries/start-list export rather than a results export."
    );
  }

  return parsed;
}

function formatName(node: Node): string {
  const first = str(node["@firstname"]) ?? "";
  const last = str(node["@lastname"]) ?? "";
  const full = `${first} ${last}`.trim();
  return full || str(node["@name"]) || "Unknown";
}

/**
 * Where the export didn't rank the results for us, rank them ourselves:
 * fastest first, within each event and age group, ignoring DQ/DNS/DNF.
 */
function computeMissingPlaces(meet: ParsedMeet) {
  const buckets = new Map<string, ParsedResult[]>();
  for (const r of meet.results) {
    const key = `${r.lenexEventId}::${r.ageGroup ?? ""}`;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  for (const list of buckets.values()) {
    if (list.some((r) => r.place !== null)) continue; // export already ranked these
    const rankable = list
      .filter((r) => !r.status && r.swimTimeCs !== null)
      .sort((a, b) => (a.swimTimeCs ?? 0) - (b.swimTimeCs ?? 0));
    rankable.forEach((r, i) => {
      // Dead heats share a place.
      r.place = i > 0 && rankable[i - 1].swimTimeCs === r.swimTimeCs
        ? rankable[i - 1].place
        : i + 1;
    });
  }
}
