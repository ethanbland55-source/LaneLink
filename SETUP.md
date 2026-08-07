# Setup — where things stand

## Already done

- **Supabase project** `CarnforthWebsite` (org `CarnforthOttersTest`, eu-west-2).
- **Schema run.** 16 tables created, Row Level Security enabled on all 16,
  16 read policies, storage bucket `otters` created.
- **Seed content in place:** 4 gala series (Winter Gala, Summer Gala, Club
  Championships, Time Trials), 7 squads, 4 venues, 4 page templates, club settings.
- **`.env` filled in** with the Supabase URL and both keys.

## Still to do — two values

Open a terminal in this folder and run:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put that 64-character string into `.env` as `AUTH_SECRET`, and pick an
`ADMIN_PASSWORD` on the line above it. Four unrelated words beats one mangled
word.

---

## The six variables for Vercel

**Settings → Environment Variables.** Tick **Production**, **Preview** and
**Development** for each. The first three you can copy straight out of `.env`.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://uaapqfovgyawfalgwrdu.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | starts `sb_publishable_…` — in `.env` |
| `SUPABASE_SECRET_KEY` | starts `sb_secret_…` — in `.env`, **keep secret** |
| `ADMIN_PASSWORD` | whatever you chose |
| `AUTH_SECRET` | the 64-character string from the command above |
| `NEXT_PUBLIC_SITE_URL` | your lane-link `.vercel.app` URL for now |

Then push this folder to the connected GitHub repo. Vercel builds on push — no
build settings need changing.

> **Note on key names.** This project uses Supabase's newer `sb_publishable_` /
> `sb_secret_` keys rather than the older `anon` / `service_role` JWTs. The code
> accepts either naming, so if you ever migrate, nothing breaks.

---

## First run-through once it's live

1. Open `/admin` on the Vercel URL and sign in with `ADMIN_PASSWORD`.
2. **Club settings** — check the contact email and socials; add squads and
   training times.
3. **Who's Who** — add committee, coaches, team managers, officials.
4. **Newsletters** — upload the latest issue.
5. **Galas** — the four series are already there. Create a gala under one.
6. Export a Lenex file from a past meet in Meet Organisation
   (**File → Export → Lenex**) and import it. Check the results look right.

## Later: the domain

Only when you're happy with it.

1. **Vercel → Settings → Domains** → add `carnforthotters.co.uk`.
2. Point the DNS at Vercel. This needs whoever holds the GoDaddy login — the
   club's WordPress site is on GoDaddy Managed WordPress, so the domain is
   almost certainly in that same account.
3. Update `NEXT_PUBLIC_SITE_URL` to `https://carnforthotters.co.uk` and redeploy.

Nothing changes for anyone until that DNS switch, and it's reversible.

---

## Things worth knowing

**Re-importing is safe.** Uploading a Lenex file replaces that gala's results and
nothing else. Last year's Winter Gala can't be clobbered by this year's Summer
Gala import.

**Publish as you go.** On gala day you can import after every session. The live
page refreshes itself every 30 seconds, so people just leave it open.

**Empty is fine.** Any section you haven't filled in shows a tidy "coming soon"
message rather than breaking.

**Check the parser before your first real gala:**

```bash
npm run test:lenex -- "C:\path\to\a-real-export.lef"
```

It prints every swimmer, time and split it found. Compare against the printed
results sheet.

**Local install quirk.** This machine has `NODE_ENV=production` set globally,
which makes `npm install` skip dev dependencies. If a fresh install looks broken:

```powershell
$env:NODE_ENV="development"; npm install --include=dev
```

Vercel is unaffected.
