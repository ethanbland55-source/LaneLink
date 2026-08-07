# Setup checklist

Work through this once. Should take about twenty minutes.

---

## 1 · Supabase

- [ ] Create a free project at **supabase.com**. Pick the London region.
- [ ] **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**.
      You should see "Success. No rows returned."
- [ ] **Project Settings → API** → copy these three, keep the tab open:
  - Project URL
  - `anon` `public` key
  - `service_role` key ← **secret, never share or commit**

## 2 · Generate a cookie secret

Run this in a terminal and copy the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3 · Fill in `.env` (local)

`.env` is already in this folder and is gitignored — it never leaves your
machine. Fill in the blanks:

```
NEXT_PUBLIC_SUPABASE_URL=      ← Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY= ← anon public key
SUPABASE_SERVICE_ROLE_KEY=     ← service_role key
ADMIN_PASSWORD=                ← pick something long
AUTH_SECRET=                   ← the string from step 2
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then:

```bash
npm install
npm run dev
```

Open <http://localhost:3000/admin> and sign in with your `ADMIN_PASSWORD`.

> If `npm install` seems to skip packages, it's this machine's global
> `NODE_ENV=production`. Use `$env:NODE_ENV="development"; npm install --include=dev`.
> Vercel is unaffected.

## 4 · GitHub

- [ ] Create a new **private** repo on GitHub (no README, no .gitignore).
- [ ] Then, in this folder:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

## 5 · Vercel

- [ ] **Add New → Project** → import the repo. Leave every build setting alone.
- [ ] **Settings → Environment Variables** → add the same six variables.
      Tick **Production**, **Preview** and **Development** for each.
      `NEXT_PUBLIC_SITE_URL` should be your `.vercel.app` URL for now.
- [ ] Deploy.

## 6 · First run-through

- [ ] Open `/admin` on the live URL and sign in.
- [ ] **Club settings** — check the contact email and socials, add the squads
      and training times.
- [ ] **Who's Who** — add the committee, coaches, team managers and officials.
- [ ] **Newsletters** — upload the latest issue.
- [ ] **Galas** — the four series are already there (Winter Gala, Summer Gala,
      Club Championships, Time Trials). Create a gala under one of them.
- [ ] Export a Lenex file from a past meet in Meet Organisation
      (**File → Export → Lenex**) and import it. Check the results look right.

## 7 · Later: the domain

Only when you're happy with it.

- [ ] **Vercel → Settings → Domains** → add `carnforthotters.co.uk`.
- [ ] Point the DNS at Vercel. This needs whoever holds the GoDaddy login —
      the club's WordPress site is on GoDaddy Managed WordPress, so the domain
      is almost certainly in that same account.
- [ ] Update `NEXT_PUBLIC_SITE_URL` to `https://carnforthotters.co.uk` and
      redeploy.

Nothing changes for anyone until that DNS switch, and it's reversible.

---

## Things worth knowing

**Re-importing is safe.** Uploading a Lenex file replaces that gala's results
and nothing else. Last year's Winter Gala can't be clobbered by this year's
Summer Gala import.

**Publish as you go.** On gala day you can import after every session. The live
page refreshes itself every 30 seconds, so people watching just leave it open.

**Empty is fine.** Any section you haven't filled in shows a tidy "coming soon"
message rather than breaking.

**Check the parser first.** Before your first real gala:

```bash
npm run test:lenex -- "C:\path\to\a-real-export.lef"
```

It prints every swimmer, time and split it found. Compare against the printed
results sheet.
