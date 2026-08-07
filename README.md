# Carnforth & District Otters ASC

The club website, rebuilt off WordPress. Next.js on Vercel, Supabase for content
and files, and a results system that imports a whole gala straight out of
Sportsystems Meet Organisation.

---

## Why it's built this way

**WordPress was the problem, not the design.** Everything here is either static
(fast, free to serve) or a small database read. There is no PHP, no plugin
updates, no hosting bill beyond Supabase's free tier.

**Results are the point.** The club already runs *SPORTSYSTEMS Meet Organisation
5.3* — the same software that produces
[results.swimming.org](https://results.swimming.org). Meet Organisation exports
**Lenex**, an XML format that carries the entire gala in one file: sessions,
events, heats, clubs, swimmers, times and splits. Upload that file and the site
builds the browsable results pages itself. No re-typing, no PDFs-only.

**Every gala keeps its own address, forever.** A gala belongs to a *series*
(Winter Gala, Summer Gala, Club Championships). Each running of it is its own
record with a permanent URL:

```
/results/winter-gala-2026     ← stays live and browsable for good
/results/summer-gala-2026     ← published later, changes nothing above
/results/series/winter-gala   ← every Winter Gala, newest first
```

Importing the Summer Gala only ever touches the Summer Gala's rows. The winter
archive cannot be overwritten by accident.

---

## Getting it running

### 1. Supabase (about five minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste in all of `supabase/schema.sql`, and
   run it. That creates every table, the security rules, the storage bucket and
   the starting content.
3. Go to **Project Settings → API** and copy three values:
   - Project URL
   - `anon` `public` key
   - `service_role` key (this one is secret)

### 2. Environment variables

Copy `.env.example` to `.env` for local work, and add the same six variables in
Vercel under **Settings → Environment Variables** (tick Production, Preview and
Development).

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL. Public. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Read-only key. Public — Row Level Security makes it safe. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret.** Server-side writes only. Never prefix it `NEXT_PUBLIC_`. |
| `ADMIN_PASSWORD` | The single password for `/admin`. Make it long. |
| `AUTH_SECRET` | Signs the admin cookie. Generate one — see below. |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL, for sitemap and share cards. |

Generate `AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

The site renders fine before Supabase is connected — every page falls back to an
empty state, so nothing crashes on a fresh clone.

### 4. Deploy

Push this folder to GitHub and import the repo in Vercel. Framework detection,
build command and output directory all need no changes. Add the environment
variables, deploy, and check the preview URL before pointing the domain at it.

---

## Publishing a gala

### Before the day

1. **Admin → Galas & results → New gala.**
2. Name it, give it a slug that includes the year (`winter-gala-2026`), pick the
   series, set the dates and venue.
3. Upload the meet conditions, programme and warm-up times under **Downloads**.
4. Tick **Published** when you want it public.

### On the day

In Meet Organisation: **File → Export → Lenex**. Upload that `.lef` or `.lxf`
file on the gala's admin page.

The importer creates every session and event, loads every swim with its splits,
works out places (using the export's own rankings where present, calculating
them from the times where not), and highlights Carnforth swims in gold.

You can re-import as often as you like — after each session, or once at the end.
Each import replaces **this gala's** results and nothing else.

### If you only have PDFs

Add the sessions by hand on the gala page and attach the start list and results
PDFs to each. You lose the swimmer search and medal table, but the pages still
work and still archive properly.

### Testing the importer first

Before your first real gala, check the parser against a genuine export:

```bash
npm run test:lenex -- "C:\path\to\your-export.lef"
```

It prints every session, event, swimmer, time and split it found. If that
matches the printed results sheet, the import will be right.

---

## What's in the admin area

| Section | What it does |
|---|---|
| **Galas & results** | Create galas and series, import Lenex, attach PDFs |
| **Newsletters** | Upload the PDF; it appears instantly and features on the home page |
| **Who's Who** | Committee, coaches, team managers and officials |
| **News posts** | Gala reports and announcements, written in Markdown |
| **Page content** | The wordy pages (About, Policies, Team protocol, FAQs, Joining, Privacy) |
| **Club settings** | Contact details, socials, squads, training times, venues, documents, supporters |

Anything you don't fill in falls back to sensible built-in copy — the site never
shows a blank page.

---

## How it's put together

```
src/
  app/                     Pages and API routes (Next.js App Router)
    results/[slug]/        A gala's programme; /events/[number] is one event
    live/                  Gala-day page, refreshes itself
    admin/                 The CMS
    api/admin/             Login, upload, records CRUD, Lenex import
  components/
    results/meet-portal    Programme / search / medals / downloads tabs
    admin/                 Reusable form + list machinery
  lib/
    lenex.ts               The Lenex parser
    queries.ts             Public reads (anon key)
    admin-queries.ts       Admin reads (service role, sees drafts)
    admin-tables.ts        Allowlist of what the admin API may write
    format.ts             Dates, times, gala status, safe Markdown
supabase/schema.sql        Run once. Tables, RLS, storage, seed content.
scripts/test-lenex.mts     Parser smoke test
```

### Security notes

- The browser only ever gets the `anon` key. Row Level Security allows reads and
  nothing else, so a leaked anon key can't change anything.
- All writes go through `/api/admin/*`, which checks the session cookie first and
  then uses the service-role key server-side.
- `src/proxy.ts` blocks every `/admin` route before it renders.
- The admin API can only touch tables and columns listed in `admin-tables.ts`.
- Uploads are restricted to documents and images — nothing executable.
- Markdown from the admin area is escaped before formatting, so pasted content
  can't inject scripts.
- Login is rate-limited and the password comparison is constant-time.

---

## Moving the domain over

`carnforthotters.co.uk` currently points at GoDaddy Managed WordPress. Deploy
here first and live with the `.vercel.app` URL for a while — nothing changes for
anyone until the DNS moves.

When you're ready: add the domain in **Vercel → Settings → Domains**, then point
the DNS at Vercel. Whoever holds the GoDaddy login needs to make that change; the
club's old site stays untouched until then, so it's fully reversible.

Old URLs (`/openmeets`, `/newsletter`, `/about-us/...`, `/joining-carnforth-otters`
and friends) already 301-redirect to their new homes — see `next.config.ts`.

### One local quirk

This machine has `NODE_ENV=production` set globally, which makes `npm install`
skip dev dependencies. If a fresh install looks broken locally:

```powershell
$env:NODE_ENV="development"; npm install --include=dev
```

Vercel is unaffected — it sets its own environment.
