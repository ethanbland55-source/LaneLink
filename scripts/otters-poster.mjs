#!/usr/bin/env node
/**
 * Carnforth Otters — gala day poster.
 *
 * This does the job ResPost does, but over HTTPS instead of FTP (Vercel has no
 * FTP server). It watches the folders SPORTSYSTEMS Meet Organisation writes to
 * and uploads each file to the website as it changes — so results appear within
 * seconds of a race being processed and nobody has to touch the site during a
 * gala.
 *
 * What it watches, by default:
 *   C:\SPORTSYS\SSMeet\<meet>\webpages   start lists, results, PDFs
 *   C:\SPORTSYS\SSMeet\<meet>\LiveRes    the rolling "last race" panel
 *
 * Usage (from a terminal on the meet laptop):
 *
 *   node otters-poster.mjs --token <gala token> --dir "C:\SPORTSYS\SSMeet\WinterGala26\webpages"
 *
 * Optional:
 *   --live "C:\SPORTSYS\SSMeet\WinterGala26\LiveRes"   the live panel folder
 *   --url  https://carnforthotters.co.uk               the site (defaults below)
 *   --every 5                                          seconds between scans
 *   --once                                             upload everything and stop
 *
 * The token comes from the gala's page in the club admin area. It only works
 * for that one gala, so it can be handed to whoever is running the timing
 * without giving them access to anything else.
 *
 * No installation, no dependencies — just Node 18 or newer.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/* ---- Arguments ----------------------------------------------------------- */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const TOKEN = flag("token", process.env.OTTERS_TOKEN);
const WATCH_DIR = flag("dir", process.env.OTTERS_DIR);
const LIVE_DIR = flag("live", process.env.OTTERS_LIVE_DIR);
const SITE = (flag("url", process.env.OTTERS_URL) ?? "https://carnforthotters.co.uk").replace(/\/$/, "");
const EVERY = Number(flag("every", "5")) * 1000;
const ONCE = has("once");

if (!TOKEN || !WATCH_DIR) {
  console.error(`
Carnforth Otters gala poster

  node otters-poster.mjs --token <gala token> --dir "<path to webpages folder>"

  --token   the upload token from the gala's page in the club admin area
  --dir     Meet Organisation's "webpages" folder for this meet
  --live    (optional) the "LiveRes" folder, for the last-race panel
  --url     (optional) the site address, default ${SITE}
  --every   (optional) seconds between scans, default 5
  --once    upload everything once and exit
`);
  process.exit(1);
}

/* ---- Which files are worth sending --------------------------------------- */

// Meet Organisation's own page shell — the site has its own design.
const SKIP = new Set([
  "index.htm", "index.html", "index2.htm", "main.htm", "top.htm", "before.htm",
  "after.htm", "disqcode.htm", "style.css", "menu.htm", "live.htm",
]);

const WANTED = /\.(html?|pdf|csv|xlsx?|docx?)$/i;

function worthSending(name) {
  const lower = name.toLowerCase();
  if (SKIP.has(lower)) return false;
  if (lower.startsWith("~") || lower.startsWith(".")) return false;
  return WANTED.test(lower);
}

/* ---- State --------------------------------------------------------------- */

/** filename → last modified time we've successfully uploaded. */
const sent = new Map();
let uploaded = 0;
let failed = 0;

const stamp = () => new Date().toLocaleTimeString("en-GB");
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

/* ---- Upload -------------------------------------------------------------- */

async function upload(dir, name) {
  const path = join(dir, name);
  const body = new FormData();
  body.append("file", new Blob([await readFile(path)]), name);
  body.append("filename", name);

  const response = await fetch(`${SITE}/api/ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body,
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }

  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }

  if (data.action === "skipped") return `skipped (${data.reason})`;
  if (data.action === "live-panel") return "live panel updated";
  if (data.action === "file") return "document";
  return `${data.action} · event ${data.event ?? "?"} · ${data.rows ?? 0} rows`;
}

async function scan(dir, label) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    log(`! cannot read ${label} folder: ${err.message}`);
    return;
  }

  for (const name of names.sort()) {
    if (!worthSending(name)) continue;

    const path = join(dir, name);
    let info;
    try { info = await stat(path); } catch { continue; }
    if (!info.isFile() || info.size === 0) continue;

    const key = `${dir}::${name}`;
    const signature = `${info.mtimeMs}:${info.size}`;
    if (sent.get(key) === signature) continue;

    try {
      const outcome = await upload(dir, name);
      sent.set(key, signature);
      uploaded += 1;
      log(`→ ${name.padEnd(18)} ${outcome}`);
    } catch (err) {
      failed += 1;
      // Don't record the signature, so it retries on the next pass.
      log(`✗ ${name.padEnd(18)} ${err.message}`);
    }
  }
}

/* ---- Run ----------------------------------------------------------------- */

const dirs = [[resolve(WATCH_DIR), "results"]];
if (LIVE_DIR) dirs.push([resolve(LIVE_DIR), "live"]);

console.log(`
Carnforth Otters gala poster
  site     ${SITE}
  watching ${dirs.map(([d]) => d).join("\n           ")}
  scanning every ${EVERY / 1000}s${ONCE ? " (once)" : ""}

Leave this window open for the whole gala. Ctrl+C to stop.
`);

async function pass() {
  for (const [dir, label] of dirs) await scan(dir, label);
}

await pass();

if (ONCE) {
  log(`Done. ${uploaded} uploaded, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

setInterval(() => {
  pass().catch((err) => log(`! ${err.message}`));
}, EVERY);

process.on("SIGINT", () => {
  log(`Stopped. ${uploaded} uploaded, ${failed} failed this session.`);
  process.exit(0);
});
