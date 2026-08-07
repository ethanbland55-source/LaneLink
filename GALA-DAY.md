# Gala day — how the results actually get onto the site

You were right: nobody uploads results one at a time. Here's what really happens
now, and how the new site plugs into it.

## What Meet Organisation already does

SPORTSYSTEMS Meet Organisation writes results to disk as the meet runs:

| When | What it writes | Where |
|---|---|---|
| Before the meet | `index.htm`, `main.htm`, `top.htm` — the page shell | `webpages` |
| Start of each session | `S*.HTM` start lists, once heats are drawn | `webpages` |
| As each event is processed | `R*.HTM` results | `webpages` |
| After each race | `lastresult.htm` — the rolling "last race" panel | `LiveRes` |
| Whenever you print one | PDF results sheets | `webpages` |

Both folders sit under `C:\SPORTSYS\SSMeet\<your meet>\`.

**This is why heats only appear at the warm-up.** It isn't a permission setting —
the start-list files simply don't exist until Meet Organisation draws that
session's heats. The same is true on the Aquatics GB site.

## What used to move them to the web

A SPORTSYSTEMS add-on called **ResPost** watches the `webpages` folder every four
seconds and FTP-uploads anything new or changed. That's how PDFs land in
`carnforthotters.co.uk/live/` today.

## What replaces it

Vercel has no FTP server, so ResPost can't post to the new site. `scripts/otters-poster.mjs`
does the same job over HTTPS instead:

```
node otters-poster.mjs --token <gala token> ^
  --dir  "C:\SPORTSYS\SSMeet\WinterGala26\webpages" ^
  --live "C:\SPORTSYS\SSMeet\WinterGala26\LiveRes" ^
  --url  https://your-site.vercel.app
```

It scans both folders every five seconds and sends each changed file to
`/api/ingest`. The site then:

- **`R*.HTM`** → parses the results table and publishes that event, with splits,
  places, points and Otters swims highlighted
- **`S*.HTM`** → publishes the start list, heat by heat
- **`lastresult.htm`** → updates the live panel
- **PDFs** → attaches them to the gala's downloads
- **`index.htm` and friends** → ignored, since the site has its own design

The token is on the gala's page in the club admin area, under **Gala day: publish
automatically**. It only works for that one gala, so it's safe to hand to whoever
runs the timing.

Node 18 or newer is the only requirement — no install, no dependencies.

## The order of a gala

1. **Weeks before** — create the gala in admin, tick Published, upload the
   conditions and programme. The page is live with everything except results.
2. **Morning of** — start the poster script before the first warm-up.
3. **Each warm-up** — Meet Organisation draws that session's heats, the files
   appear, the session flips from *"Heats published at the warm-up"* to
   *"Heats published"*.
4. **During the session** — each event's results appear as the referee confirms
   them. The session shows *"Results coming in"*.
5. **End of session** — all events have results; the session shows *"Complete"*.
6. **After the meet** — export Lenex (**File → Export → Lenex**) and import it on
   the gala's admin page. That replaces the live-parsed data with the
   authoritative version: full splits, official rankings, relay legs.

Step 6 is optional but worth doing — it's the difference between "what we
published on the day" and a permanent, properly structured archive.

## Checking it before it matters

Point the parser at a real folder from a past meet:

```bash
npm run test:sportsys -- "C:\SPORTSYS\SSMeet\SomeOldMeet\webpages"
```

It prints every swimmer, time and split it found, so you can compare against the
printed results sheet without touching the live site.

To rehearse the whole pipeline, run the poster with `--once` against an old
meet's folder pointed at a test gala.

## If something goes wrong mid-gala

- The poster retries failed files automatically on the next scan — a dropped
  connection fixes itself.
- Closing and restarting the poster is safe; it re-sends anything that changed.
- Re-sending a file replaces that event's rows rather than duplicating them.
- Worst case, the PDFs still upload, so people can always download the sheets.
